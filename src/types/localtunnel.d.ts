declare module 'localtunnel' {
  export interface Tunnel {
    url: string;
    on(event: 'close', listener: () => void): void;
    close(): void;
  }

  interface TunnelOptions {
    port: number;
    subdomain?: string;
    host?: string;
  }

  function localtunnel(options: TunnelOptions): Promise<Tunnel>;
  export default localtunnel;
}
