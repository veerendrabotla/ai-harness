import type { Documentation, DocSection, DocConfig } from "./types.js";

export class AIDocsGenerator {
  private config: DocConfig;

  constructor(config?: DocConfig) {
    this.config = {
      format: config?.format ?? "markdown",
      includeExamples: config?.includeExamples ?? true,
      includeTypes: config?.includeTypes ?? true,
    };
  }

  async generateDocs(sourceCode: string, filename: string): Promise<Documentation> {
    return {
      title: filename,
      description: `Documentation for ${filename}`,
      sections: this.extractSections(sourceCode, filename),
      generatedAt: new Date(),
    };
  }

  async generateApiDocs(sourceCode: string): Promise<Documentation> {
    const sections: DocSection[] = [];

    // Extract exported functions with JSDoc
    const funcRegex = /(?:\/\*\*([\s\S]*?)\*\/\s*)?(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
    let match;
    const functions: string[] = [];

    while ((match = funcRegex.exec(sourceCode)) !== null) {
      const jsdoc = match[1]?.trim();
      const name = match[2];
      const params = match[3];

      let doc = `### \`${name}(${params})\`\n\n`;
      if (jsdoc) {
        const descMatch = jsdoc.match(/^[\s\*]*(.+?)(?:\n|$)/);
        if (descMatch) doc += `${descMatch[1]}\n\n`;

        const paramDocs = [...jsdoc.matchAll(/@param\s+\{[^}]*\}\s+(\w+)\s*[-–]\s*(.+)/g)];
        if (paramDocs.length > 0) {
          doc += `**Parameters:**\n`;
          for (const pd of paramDocs) {
            doc += `- \`${pd[1]}\`: ${pd[2]}\n`;
          }
          doc += "\n";
        }

        const returnDoc = jsdoc.match(/@returns?\s+\{[^}]*\}\s*[-–]\s*(.+)/);
        if (returnDoc) doc += `**Returns:** ${returnDoc[1]}\n\n`;
      }
      functions.push(doc);
    }

    if (functions.length > 0) {
      sections.push({ title: "Functions", content: functions.join("\n") });
    }

    // Extract exported interfaces/types
    const typeRegex = /(?:export\s+)?(?:interface|type)\s+(\w+)(?:<[^>]*>)?\s*(?:extends\s+[^{]+)?\{([\s\S]*?)\}/g;
    const types: string[] = [];
    while ((match = typeRegex.exec(sourceCode)) !== null) {
      const name = match[1]!;
      const body = (match[2] ?? "").trim();
      const props = body.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
        const propMatch = l.match(/(\w+)\??\s*:\s*([^;]+)/);
        return propMatch ? `- \`${propMatch[1]}\`: ${propMatch[2]?.trim() ?? "unknown"}` : `- ${l}`;
      }).join("\n");
      types.push(`### \`${name}\`\n\n${props}\n`);
    }

    if (types.length > 0) {
      sections.push({ title: "Types", content: types.join("\n") });
    }

    return {
      title: "API Documentation",
      description: "Auto-generated API documentation",
      sections,
      generatedAt: new Date(),
    };
  }

  private extractSections(sourceCode: string, _filename: string): DocSection[] {
    const sections: DocSection[] = [];

    // Extract function signatures
    const functionMatches = sourceCode.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g);
    if (functionMatches && functionMatches.length > 0) {
      sections.push({
        title: "Functions",
        content: functionMatches.join("\n"),
      });
    }

    // Extract class definitions
    const classMatches = sourceCode.match(/(?:export\s+)?class\s+(\w+)/g);
    if (classMatches && classMatches.length > 0) {
      sections.push({
        title: "Classes",
        content: classMatches.join("\n"),
      });
    }

    // Extract interfaces
    const interfaceMatches = sourceCode.match(/(?:export\s+)?interface\s+(\w+)/g);
    if (interfaceMatches && interfaceMatches.length > 0) {
      sections.push({
        title: "Interfaces",
        content: interfaceMatches.join("\n"),
      });
    }

    return sections;
  }

  formatDocumentation(docs: Documentation): string {
    if (this.config.format === "markdown") {
      return this.toMarkdown(docs);
    }
    if (this.config.format === "json") {
      return JSON.stringify(docs, null, 2);
    }
    return this.toMarkdown(docs);
  }

  private toMarkdown(docs: Documentation): string {
    let md = `# ${docs.title}\n\n${docs.description}\n\n`;

    for (const section of docs.sections) {
      md += `## ${section.title}\n\n${section.content}\n\n`;
    }

    return md;
  }
}
