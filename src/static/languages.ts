export interface LanguageConfig {
  name: string
  extensions: string[]
  localImports: RegExp[]
  exports: RegExp[]
  exportList: RegExp | null
  classes: RegExp[]
  functions: RegExp[]
  throws: RegExp[]
}

export const languages: LanguageConfig[] = [
  {
    name: 'typescript',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    localImports: [
      /import\s+(?:[\w{},\s*]+\s+from\s+)?['"](\.[^'"]+)['"]/,
      /require\(\s*['"](\.[^'"]+)['"]\s*\)/,
    ],
    exports: [
      /export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+(\w+)/,
    ],
    exportList: /export\s+\{([^}]+)\}/,
    classes: [
      /(?:export\s+(?:default\s+)?)?class\s+(\w+)/,
    ],
    functions: [
      /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)/,
      /(?:export\s+(?:default\s+)?)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/,
      /(?:export\s+(?:default\s+)?)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?(?:function)/,
    ],
    throws: [
      /throw\s+new\s+(\w+)/,
    ],
  },
  {
    name: 'python',
    extensions: ['.py', '.pyi'],
    localImports: [
      /from\s+(\.[\w.]+)\s+import/,
      /import\s+(\.[\w.]+)/,
    ],
    exports: [
      /class\s+(\w+)/,
      /def\s+(\w+)/,
    ],
    exportList: /__all__\s*=\s*\[([^\]]+)\]/,
    classes: [
      /class\s+(\w+)/,
    ],
    functions: [
      /def\s+(\w+)/,
    ],
    throws: [
      /raise\s+(\w+)/,
    ],
  },
  {
    name: 'go',
    extensions: ['.go'],
    localImports: [],
    exports: [
      /func\s*\([^)]*\)\s+([A-Z]\w*)/,
      /func\s+([A-Z]\w*)\s*\(/,
      /type\s+([A-Z]\w*)\s+struct/,
      /type\s+([A-Z]\w*)\s+interface/,
    ],
    exportList: null,
    classes: [
      /type\s+(\w+)\s+struct/,
    ],
    functions: [
      /func\s*(?:\([^)]*\)\s+)?(\w+)\s*\(/,
    ],
    throws: [],
  },
  {
    name: 'rust',
    extensions: ['.rs'],
    localImports: [
      /use\s+(?:crate|super)::(\w+)/,
    ],
    exports: [
      /pub\s+(?:async\s+)?fn\s+(\w+)/,
      /pub\s+struct\s+(\w+)/,
      /pub\s+enum\s+(\w+)/,
      /pub\s+trait\s+(\w+)/,
    ],
    exportList: null,
    classes: [
      /(?:pub\s+)?struct\s+(\w+)/,
    ],
    functions: [
      /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/,
    ],
    throws: [],
  },
  {
    name: 'java',
    extensions: ['.java'],
    localImports: [],
    exports: [
      /public\s+(?:static\s+)?(?:class|interface|enum)\s+(\w+)/,
    ],
    exportList: null,
    classes: [
      /(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/,
    ],
    functions: [
      /(?:public|protected)\s+(?:static\s+)?(?:[\w<>\[\]]+\s+)+(\w+)\s*\(/,
    ],
    throws: [
      /throw\s+new\s+(\w+)/,
      /throws\s+([\w\s,]+)/,
    ],
  },
  {
    name: 'ruby',
    extensions: ['.rb'],
    localImports: [
      /require_relative\s+['"](.+?)['"]/,
    ],
    exports: [
      /class\s+(\w+)/,
      /module\s+(\w+)/,
      /def\s+(\w+)/,
    ],
    exportList: null,
    classes: [
      /class\s+(\w+)/,
    ],
    functions: [
      /def\s+(\w+)/,
    ],
    throws: [
      /raise\s+(\w+)/,
    ],
  },
]