declare type BufferLike = Uint8Array | number[];
export declare namespace Key {
    const SIG_LENGTH = 71;
    class Public {
        static readonly LENGTH = 34;
        readonly address: string;
        private readonly point;
        private readonly keyPair;
        private readonly checksum;
        constructor(data: Public | string | BufferLike);
        verify(data: string | BufferLike, signature: string | BufferLike): boolean;
        toString(): string;
        toJSON(): string;
    }
    class Private {
        private readonly keyPair;
        private readonly stringRepresentation;
        constructor(data: Private | string | BufferLike);
        static generate(): Private;
        private _cachedPublic;
        getPublic(): Public;
        sign(data: string | BufferLike, fixedLength?: boolean): Uint8Array;
        derive(pub: Public | string | BufferLike): Uint8Array;
        exportEncrypted(password: string, salt: string, iterations: number): string;
        exportEncrypted(password: string, salt: string, iterations: number, progressObj: {
            progress?: number;
            stop?: boolean;
        }): Promise<string | null>;
        static importEncrypted(encryptedVal: string, password: string, salt: string, iterations: number): Private;
        static importEncrypted(encryptedVal: string, password: string, salt: string, iterations: number, progressObj: {
            progress?: number;
            stop?: boolean;
        }): Promise<Private | null>;
        toString(): string;
        toJSON(): string;
    }
}
export default Key;
