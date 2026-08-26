// Type declarations for Bun text imports (with { type: 'text' })
declare module '*.svg' {
  const content: string
  export default content
}

declare module '*.css' {
  const content: string
  export default content
}

declare module '*/LICENSE' {
  const content: string
  export default content
}
