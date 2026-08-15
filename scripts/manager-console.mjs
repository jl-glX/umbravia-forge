import process from "node:process";
import readline from "node:readline/promises";

function readArguments(argv) {
  const result = {
    url: "https://www.umbraviaforge.com",
    channel: "external",
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--url" && argv[index + 1]) {
      result.url = argv[++index];
    } else if (argv[index] === "--channel" && argv[index + 1]) {
      result.channel = argv[++index];
    } else if (argv[index] === "--help" || argv[index] === "-h") {
      process.stdout.write(
        "Uso: npm run manager:console -- --url <https://...> --channel external\n",
      );
      process.exit(0);
    } else {
      throw new Error(`Argumento no reconocido: ${argv[index]}`);
    }
  }
  const parsedUrl = new URL(result.url);
  const localDevelopmentHost =
    parsedUrl.hostname === "localhost" ||
    parsedUrl.hostname === "127.0.0.1" ||
    parsedUrl.hostname === "[::1]";
  if (
    parsedUrl.protocol !== "https:" &&
    !(parsedUrl.protocol === "http:" && localDevelopmentHost)
  ) {
    throw new Error(
      "La terminal externa exige HTTPS; HTTP solo se admite en localhost para desarrollo",
    );
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.hash) {
    throw new Error("La URL no puede contener credenciales ni fragmentos");
  }
  if (result.channel !== "external") {
    throw new Error(
      "El cliente de terminal solo abre sesiones externas temporales; el canal interno pertenece a la app corporativa verificada",
    );
  }
  return result;
}

async function readCredential() {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    const fallback = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      return (await fallback.question("Credencial de terminal: ")).trim();
    } finally {
      fallback.close();
    }
  }
  process.stdout.write("Credencial de terminal: ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return await new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (character) => {
      if (character === "\u0003") {
        finish();
        reject(new Error("Entrada cancelada"));
      } else if (character === "\r" || character === "\n") {
        finish();
        resolve(value.trim());
      } else if (character === "\u007f" || character === "\b") {
        if (value.length) {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else if (/^[\x20-\x7E]$/.test(character)) {
        value += character;
        process.stdout.write("*");
      }
    };
    process.stdin.on("data", onData);
  });
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Respuesta no válida del servidor (${response.status})`);
  }
}

async function main() {
  const options = readArguments(process.argv.slice(2));
  const baseUrl = options.url.replace(/\/$/, "");
  const credential = await readCredential();
  const connectResponse = await fetch(
    `${baseUrl}/api/admin/manager-console/terminal/connect`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential, channel: options.channel }),
    },
  );
  const connection = await readJson(connectResponse);
  if (!connectResponse.ok || !connection.terminalSessionToken) {
    throw new Error(
      connection.error || "No se pudo abrir la sesión de terminal",
    );
  }

  const sessionToken = connection.terminalSessionToken;
  const headers = {
    Authorization: `Umbravia-Terminal ${sessionToken}`,
    "Content-Type": "application/json",
    "X-Umbravia-Channel": options.channel,
  };
  let closing = false;
  let interrupted = false;
  const disconnect = async () => {
    if (closing) return;
    closing = true;
    try {
      await fetch(`${baseUrl}/api/admin/manager-console/terminal/disconnect`, {
        method: "POST",
        headers,
      });
    } catch {
      // The server-side idle policy remains the fallback after a network loss.
    }
  };

  const overviewResponse = await fetch(
    `${baseUrl}/api/admin/manager-console/terminal/overview`,
    { headers },
  );
  const overview = await readJson(overviewResponse);
  if (!overviewResponse.ok) {
    await disconnect();
    throw new Error(
      overview.error || "No se pudo cargar el perfil de terminal",
    );
  }

  process.stdout.write(
    `Umbravia Forge · ${overview.shell} · canal ${options.channel}\n`,
  );
  process.stdout.write(
    `${new URL(baseUrl).protocol === "https:" ? "TLS autenticado" : "HTTP local de desarrollo"}: las credenciales y órdenes viajan cifradas en producción.\n`,
  );
  process.stdout.write(
    "Entorno Linux aislado: sin secretos, archivos del anfitrión ni socket de contenedores.\n",
  );
  process.stdout.write(
    "Admite comandos Linux, alias portables de Windows y clientes Samba. ufctl help muestra las órdenes corporativas.\n\n",
  );

  let contextProfileId = overview.access.authorityProfileId;
  let contextUnitId = null;
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const heartbeatIntervalMs = 30_000;
  const suspendToleranceMs = 90_000;
  let lastHeartbeatTick = Date.now();
  const heartbeatTimer = setInterval(async () => {
    if (closing || interrupted) return;
    const now = Date.now();
    if (now - lastHeartbeatTick > suspendToleranceMs) {
      process.stderr.write(
        "La sesión se ha cerrado después de una suspensión o hibernación.\n",
      );
      interrupted = true;
      terminal.close();
      await disconnect();
      return;
    }
    lastHeartbeatTick = now;
    try {
      const response = await fetch(
        `${baseUrl}/api/admin/manager-console/terminal/heartbeat`,
        { method: "POST", headers },
      );
      if (!response.ok) {
        interrupted = true;
        terminal.close();
      }
    } catch {
      // A later command or the server timeout will close an unreachable session.
    }
  }, heartbeatIntervalMs);
  const stop = () => {
    interrupted = true;
    terminal.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    while (!interrupted) {
      let command;
      try {
        const unit = overview.units?.find(
          (candidate) => candidate.id === contextUnitId,
        );
        const promptContext = unit
          ? `${contextProfileId}:${unit.slug}`
          : contextProfileId;
        command = (
          await terminal.question(`${promptContext}@umbravia-forge:$ `)
        ).trim();
      } catch {
        break;
      }
      if (!command) continue;
      if (command === "exit" || command === "quit") break;
      if (command === "clear") {
        process.stdout.write("\u001Bc");
        continue;
      }
      const response = await fetch(
        `${baseUrl}/api/admin/manager-console/terminal/execute`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ command, contextProfileId, contextUnitId }),
        },
      );
      const result = await readJson(response);
      if (response.status === 401) {
        process.stderr.write(
          "La sesión ha sido revocada o ha caducado por inactividad, suspensión o pérdida de confianza.\n",
        );
        break;
      }
      if (!response.ok) {
        process.stderr.write(`${result.error || "Orden rechazada"}\n`);
        continue;
      }
      for (const line of result.lines || []) process.stdout.write(`${line}\n`);
      for (const line of result.errorLines || []) {
        if (line) process.stderr.write(`${line}\n`);
      }
      if (Object.hasOwn(result, "nextContextProfileId")) {
        contextProfileId = result.nextContextProfileId;
      }
      if (Object.hasOwn(result, "nextContextUnitId")) {
        contextUnitId = result.nextContextUnitId;
      }
    }
  } finally {
    clearInterval(heartbeatTimer);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    terminal.close();
    await disconnect();
    process.stdout.write("Sesión de terminal cerrada.\n");
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "No se pudo iniciar la terminal"}\n`,
  );
  process.exitCode = 1;
});
