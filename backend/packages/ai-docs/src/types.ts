export interface Documentation {
  title: string;
  description: string;
  sections: DocSection[];
  generatedAt: Date;
}

export interface DocSection {
  title: string;
  content: string;
  subsections?: DocSection[];
}

export interface DocConfig {
  format: "markdown" | "html" | "json";
  includeExamples?: boolean;
  includeTypes?: boolean;
}
