export interface TokenStore {
  save(site: string, data: unknown): Promise<void>
  load<T>(site: string): Promise<T | null>
  clear(site: string): Promise<void>
}

export interface AuthService<C = any> {
  login(credentials: C): Promise<void>
  getToken(): Promise<string | null>
}

export interface ArchidektToken {
  access_token: string
  refresh_token: string
  token_type: string
  access_token_expiration?: string // Date string from API
  scope: string
  user: {
    id: number
    username: string
  }
}

export interface ArchidektCredentials {
  username: string
  password?: string
}
