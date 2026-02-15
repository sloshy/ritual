export interface ArchidektCategory {
  id: number
  name: string
}

export interface ArchidektCardEntry {
  card?: {
    oracleCard?: { name: string }
    name: string
  }
  quantity?: number
  categories?: number[] // Array of category IDs
}

export interface ArchidektDeckResponse {
  name?: string
  description?: string
  categories?: ArchidektCategory[]
  cards?: ArchidektCardEntry[]
}
