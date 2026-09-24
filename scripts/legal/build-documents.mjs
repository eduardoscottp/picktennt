import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const directory = resolve(root, "content/legal/ios");
const publication = JSON.parse(readFileSync(resolve(directory, "publication.json"), "utf8"));

for (const [file, slug] of [["terms-of-use.md", "terms"], ["privacy-policy.md", "privacy"]]) {
  const source = readFileSync(resolve(directory, file), "utf8");
  if (publication.effectiveDate && /REVIEW COPY|Pending publication|Not yet approved/.test(source)) {
    throw new Error("The dated legal publication still contains review markers.");
  }
  const title = source.match(/^# (.+)/)?.[1];
  const body = source.slice(source.indexOf("## 1.")).split("\n---")[0];
  const blocks = body.trim().split(/\n\s*\n/).map((paragraph) => {
    if (paragraph.startsWith("## ")) {
      const text = paragraph.slice(3).trim();
      return { kind: "heading", text, id: `section-${text.match(/^\d+/)?.[0]}` };
    }
    if (paragraph.startsWith("- ")) {
      return { kind: "list", items: paragraph.split("\n").map((line) => line.replace(/^- /, "")) };
    }
    return { kind: "paragraph", text: paragraph.replace(/\n/g, " ") };
  });
  if (!title || blocks.length < 10 || blocks.some((block) => block.id === "section-undefined")) {
    throw new Error(`Invalid legal document: ${file}`);
  }
  const output = JSON.stringify({ title, blocks }, null, 2) + "\n";
  const destination = resolve(directory, `${slug}.json`);
  if (process.argv.includes("--check")) {
    if (readFileSync(destination, "utf8") !== output) throw new Error(`Stale rendered copy: ${file}`);
  } else {
    writeFileSync(destination, output);
  }
}
console.log("Legal documents match the Markdown review source.");
