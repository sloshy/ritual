/** Replace any non-ASCII-alphanumeric character with an underscore for a safe download filename. */
export const safeFilename = (name: string): string => name.replace(/[^a-zA-Z0-9]/g, '_')
