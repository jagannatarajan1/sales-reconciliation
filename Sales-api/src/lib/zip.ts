import { ZipArchive } from "archiver";

export function buildZip(files: Array<{ name: string; content: Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive();
    const chunks: Buffer[] = [];

    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);

    for (const file of files) {
      archive.append(file.content, { name: file.name });
    }

    archive.finalize();
  });
}
