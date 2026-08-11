import {
  resolve4,
  resolve6,
  resolveMx,
  resolveTxt,
  reverse,
} from "node:dns/promises";

export type MailDnsFindingLevel = "pass" | "warning" | "error";

export interface MailDnsFinding {
  code: string;
  level: MailDnsFindingLevel;
  message: string;
}

export interface MailDnsResolver {
  resolveMx(
    domain: string,
  ): Promise<Array<{ exchange: string; priority: number }>>;
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
  reverse(ip: string): Promise<string[]>;
  resolveTxt(hostname: string): Promise<string[][]>;
}

export interface MailDnsReadinessInput {
  emailFrom: string;
  expectedMailHost?: string;
  dkimSelector?: string;
  strictAuthentication?: boolean;
  inboundEnabled?: boolean;
  inboundProvider?: "postfix" | "cloudflare";
}

const systemResolver: MailDnsResolver = {
  resolveMx,
  resolve4,
  resolve6,
  reverse,
  resolveTxt,
};

function normalizedHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

async function optionalLookup<T>(
  lookup: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await lookup();
  } catch {
    return fallback;
  }
}

function authenticationLevel(strict: boolean): MailDnsFindingLevel {
  return strict ? "error" : "warning";
}

export function extractSenderDomain(emailFrom: string): string | null {
  const bracketed = emailFrom.match(/<\s*[^<>@\s]+@([^<>\s]+)\s*>\s*$/);
  const plain = emailFrom.trim().match(/^[^<>@\s]+@([^<>\s]+)$/);
  const domain = bracketed?.[1] ?? plain?.[1];
  return domain ? normalizedHostname(domain) : null;
}

export async function assessMailDnsReadiness(
  input: MailDnsReadinessInput,
  resolver: MailDnsResolver = systemResolver,
): Promise<MailDnsFinding[]> {
  const findings: MailDnsFinding[] = [];
  const senderDomain = extractSenderDomain(input.emailFrom);
  if (!senderDomain) {
    return [
      {
        code: "EMAIL_FROM_INVALID",
        level: "error",
        message: "EMAIL_FROM no contiene una direccion de correo valida.",
      },
    ];
  }

  let expectedMailHost = input.expectedMailHost
    ? normalizedHostname(input.expectedMailHost)
    : undefined;
  if (input.inboundEnabled) {
    const mxRecords = await optionalLookup(
      () => resolver.resolveMx(senderDomain),
      [],
    );
    if (mxRecords.length === 0) {
      findings.push({
        code: "MX_MISSING",
        level: "error",
        message: `${senderDomain} no publica ningun registro MX.`,
      });
      return findings;
    }

    const usableMxRecords = mxRecords.filter(
      (record) => normalizedHostname(record.exchange).length > 0,
    );
    if (usableMxRecords.length === 0) {
      findings.push({
        code: "MX_NULL",
        level: "error",
        message: `${senderDomain} publica un Null MX y declara que no acepta correo entrante.`,
      });
      return findings;
    }

    const mxHosts = [...usableMxRecords]
      .sort((left, right) => left.priority - right.priority)
      .map((record) => normalizedHostname(record.exchange));
    if (input.inboundProvider === "cloudflare") {
      if (!mxHosts.some((host) => host.endsWith(".mx.cloudflare.net"))) {
        findings.push({
          code: "MX_TARGET_MISMATCH",
          level: "error",
          message: `El MX de ${senderDomain} no apunta a Cloudflare Email Routing.`,
        });
        return findings;
      }
      findings.push({
        code: "MX_CLOUDFLARE_READY",
        level: "pass",
        message: `MX publico disponible mediante Cloudflare Email Routing para ${senderDomain}.`,
      });
    } else {
      expectedMailHost ??= mxHosts[0];
      if (!expectedMailHost || !mxHosts.includes(expectedMailHost)) {
        findings.push({
          code: "MX_TARGET_MISMATCH",
          level: "error",
          message: `El MX de ${senderDomain} no apunta al host esperado ${expectedMailHost ?? "sin definir"}.`,
        });
        return findings;
      }
      findings.push({
        code: "MX_READY",
        level: "pass",
        message: `MX publico disponible: ${senderDomain} -> ${expectedMailHost}.`,
      });
    }
  } else {
    findings.push({
      code: "INBOUND_DISABLED",
      level: "pass",
      message:
        "La recepcion SMTP publica permanece desactivada; no se exige MX.",
    });
  }

  if (!expectedMailHost) {
    findings.push({
      code: "MAIL_HOST_MISSING",
      level: "error",
      message:
        "EMAIL_PUBLIC_MAIL_HOST es obligatorio para comprobar el MTA propio.",
    });
    return findings;
  }

  const [ipv4, ipv6] = await Promise.all([
    optionalLookup(() => resolver.resolve4(expectedMailHost), []),
    optionalLookup(() => resolver.resolve6(expectedMailHost), []),
  ]);
  const addresses = [...ipv4, ...ipv6];
  if (addresses.length === 0) {
    findings.push({
      code: "MAIL_HOST_ADDRESS_MISSING",
      level: "error",
      message: `${expectedMailHost} no resuelve a ninguna direccion publica.`,
    });
  } else {
    findings.push({
      code: "MAIL_HOST_ADDRESS_READY",
      level: "pass",
      message: `${expectedMailHost} tiene resolucion directa.`,
    });
  }

  const reverseNames = (
    await Promise.all(
      addresses.map((address) =>
        optionalLookup(() => resolver.reverse(address), []),
      ),
    )
  )
    .flat()
    .map(normalizedHostname);
  if (!reverseNames.includes(expectedMailHost)) {
    findings.push({
      code: "PTR_MISMATCH",
      level: authenticationLevel(Boolean(input.strictAuthentication)),
      message: `El PTR/rDNS de la IP de correo no coincide con ${expectedMailHost}.`,
    });
  } else {
    findings.push({
      code: "PTR_READY",
      level: "pass",
      message: `PTR/rDNS alineado con ${expectedMailHost}.`,
    });
  }

  const senderTxt = (
    await optionalLookup(() => resolver.resolveTxt(senderDomain), [])
  ).map((segments) => segments.join(""));
  const dmarcTxt = (
    await optionalLookup(
      () => resolver.resolveTxt(`_dmarc.${senderDomain}`),
      [],
    )
  ).map((segments) => segments.join(""));
  const authLevel = authenticationLevel(Boolean(input.strictAuthentication));
  findings.push(
    senderTxt.some((record) => /^v=spf1\b/i.test(record))
      ? {
          code: "SPF_READY",
          level: "pass",
          message: `SPF publicado para ${senderDomain}.`,
        }
      : {
          code: "SPF_MISSING",
          level: authLevel,
          message: `Falta un registro SPF para ${senderDomain}.`,
        },
  );
  findings.push(
    dmarcTxt.some((record) => /^v=DMARC1\b/i.test(record))
      ? {
          code: "DMARC_READY",
          level: "pass",
          message: `DMARC publicado para ${senderDomain}.`,
        }
      : {
          code: "DMARC_MISSING",
          level: authLevel,
          message: `Falta un registro DMARC para ${senderDomain}.`,
        },
  );

  if (!input.dkimSelector?.trim()) {
    findings.push({
      code: "DKIM_SELECTOR_MISSING",
      level: authLevel,
      message:
        "EMAIL_DKIM_SELECTOR no esta definido; DKIM no puede comprobarse.",
    });
  } else {
    const selector = input.dkimSelector.trim().toLowerCase();
    const dkimTxt = await optionalLookup(
      () => resolver.resolveTxt(`${selector}._domainkey.${senderDomain}`),
      [],
    );
    findings.push(
      dkimTxt.some((segments) => /\bv=DKIM1\b/i.test(segments.join("")))
        ? {
            code: "DKIM_READY",
            level: "pass",
            message: `DKIM publicado con el selector ${selector}.`,
          }
        : {
            code: "DKIM_MISSING",
            level: authLevel,
            message: `No se encontro DKIM para el selector ${selector}.`,
          },
    );
  }

  return findings;
}
