import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "packaging", "windows-web-apps");
const outputDirectory = path.join(root, ".artifacts");
const output = path.join(
  outputDirectory,
  "umbravia-forge-windows-web-apps-test.zip",
);
const names = [
  "Install-WebApp.ps1",
  "Instalar-UMF-Support.cmd",
  "Instalar-Umbravia-Forge.cmd",
  "Desinstalar-UMF-Support.cmd",
  "Desinstalar-Umbravia-Forge.cmd",
  "umf-support-icon.ico",
  "umf-support-icon.png",
  "LEEME.txt",
];

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const reproducibleDosTime = 0;
const reproducibleDosDate = (1 << 5) | 1;

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(reproducibleDosTime, 10);
    local.writeUInt16LE(reproducibleDosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(reproducibleDosTime, 12);
    central.writeUInt16LE(reproducibleDosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

const entries = [];
const hashes = [];
for (const name of names) {
  const data = await readFile(path.join(source, name));
  if (/\.(?:env|pem|pfx|key|sqlite)$/i.test(name)) {
    throw new Error(
      `Sensitive file is not allowed in Windows package: ${name}`,
    );
  }
  entries.push({ name, data });
  hashes.push(`${createHash("sha256").update(data).digest("hex")}  ${name}`);
}
entries.push({
  name: "SHA256SUMS.txt",
  data: Buffer.from(`${hashes.join("\r\n")}\r\n`, "utf8"),
});

await mkdir(outputDirectory, { recursive: true });
await rm(output, { force: true });
await rm(`${output}.sha256`, { force: true });
await writeFile(output, zip(entries));
const packageHash = createHash("sha256")
  .update(await readFile(output))
  .digest("hex");
await writeFile(
  `${output}.sha256`,
  `${packageHash}  ${path.basename(output)}\n`,
);
console.log(`Windows test package prepared: ${output}`);
console.log(`SHA-256: ${packageHash}`);
