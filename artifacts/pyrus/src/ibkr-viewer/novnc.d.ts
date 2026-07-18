declare module "@novnc/novnc/core/rfb.js" {
  type RfbOptions = {
    shared?: boolean;
    wsProtocols?: string[];
  };

  export default class RFB {
    constructor(target: HTMLElement, url: string, options?: RfbOptions);
    background: string;
    clipViewport: boolean;
    resizeSession: boolean;
    scaleViewport: boolean;
    viewOnly: boolean;
    addEventListener(
      type: string,
      listener: (event: Event & { detail?: { clean?: boolean } }) => void,
    ): void;
    disconnect(): void;
  }
}
