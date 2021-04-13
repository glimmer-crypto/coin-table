import { sha512 } from "hash.js"
import { hash, Buffer, Convert, BN } from "./utils";
import * as elliptic from "elliptic"

interface EC extends elliptic.ec {
  curve: elliptic.curve.short

  keyFromPublic(pub: string | elliptic.ec.KeyPair | Uint8Array | Buffer | number[] | { x: string, y: string } | elliptic.curve.base.BasePoint, enc?: string): elliptic.ec.KeyPair
}
const ec: EC = new elliptic.ec("secp256k1")


type BufferLike = Uint8Array | number[]

function checksum(data: BufferLike, modulo: number): number {
  let sum = 0
  for (let i = 0; i < data.length; i++) {
    sum = (sum + data[i]) % modulo
  }

  return sum
}

const MB = 1024 * 1024
function kdf(input: string, iterations: number) {
  const sha = sha512()
  sha.update(input)

  const expanded = new Uint8Array(MB)
  expanded.set(sha.digest())
  let digestLength = 64
  let digestIndex = 0
  let setIndex = 0

  for (let i = 0; i < iterations; i++) {
    digestIndex = digestIndex % (MB - 64) % digestLength
    sha.update(expanded.subarray(digestIndex, digestIndex + 64))
    sha.update(Convert.int64ToBuffer(i))

    const hashResult = sha.digest()
    const int32Arr = new Uint32Array(new Uint8Array(hashResult).buffer)
    let indexChange = 0
    for (let i = 0; i < 16; i++) {
      indexChange ^= int32Arr[i]
    }
    digestIndex += indexChange >>> 0

    setIndex += 64
    if (setIndex >= MB) {
      setIndex = 0
    }

    expanded.set(hashResult, setIndex)
    digestLength += 64
  }

  digestIndex = digestIndex % (digestLength - 64)
  return expanded.slice(digestIndex, digestIndex + 64)
}

function kdfWithProgress(input: string, iterations: number, progressObj: { progress?: number, stop?: boolean }): Promise<Uint8Array | null> {
  return new Promise(resolve => {
    const sha = sha512()
    sha.update(input)

    const expanded = new Uint8Array(MB)
    expanded.set(sha.digest())
    let digestLength = 64
    let digestIndex = 0
    let setIndex = 0

    let i = 0
    const hashIteration = () => {
      const chunkIterations = Math.max(25, iterations / 100)
      for (let j = 0; j < chunkIterations; j++) {
        digestIndex = digestIndex % (MB - 64) % digestLength
        sha.update(expanded.subarray(digestIndex, digestIndex + 64))
        sha.update(Convert.int64ToBuffer(i))

        const hashResult = sha.digest()
        const int32Arr = new Uint32Array(new Uint8Array(hashResult).buffer)
        let indexChange = 0
        for (let i = 0; i < 16; i++) {
          indexChange ^= int32Arr[i]
        }
        digestIndex += indexChange >>> 0

        setIndex += 64
        if (setIndex >= MB) {
          setIndex = 0
        }

        expanded.set(hashResult, setIndex)
        digestLength += 64

        i++
        if (i >= iterations) { break }
      }

      if (progressObj.stop === true) {
        return resolve(null)
      }

      progressObj.progress = i / iterations
      if (i < iterations) {
        setTimeout(hashIteration, 0)
      } else {
        digestIndex = digestIndex % (digestLength - 64)
        resolve(expanded.slice(digestIndex, digestIndex + 64))
      }
    }
    setTimeout(hashIteration, 0)
  })
}

export namespace Key {
  export const SIG_LENGTH = 71

  export class Public {
    static readonly LENGTH = 34

    readonly address: string
    private readonly point: elliptic.curve.base.BasePoint
    private readonly keyPair: elliptic.ec.KeyPair
    private readonly checksum: number
  
    constructor(data: Public | string | BufferLike) {
      if (data instanceof Public) { return data }

      let buffer: BufferLike
      if (typeof data === "string") {
        buffer = Convert.Base58.decodeBuffer(data)
        this.address = Convert.Base58.normalize(data)
      } else {
        buffer = data
        this.address = Convert.Base58.encode(data)
      }

      const version = buffer[0]
      if (version !== 1) {
        throw new Error("Not a valid address (unknown version)")
      }
  
      const x = buffer.slice(1, -1)
      const checkByte = buffer[buffer.length - 1]
      const yIsOdd = !!(checkByte >> 7)
      const checksumBits = checkByte & 127
  
      const point = ec.curve.pointFromX(x, yIsOdd)
      this.point = point
      this.keyPair = ec.keyFromPublic(point)
      this.checksum = checksum(point.encode("array", false), 127)
  
      if (this.checksum !== checksumBits) {
        throw new Error("Not a valid address (checksum doesn't match)")
      }
    }
  
    verify(data: string | BufferLike, signature: string | BufferLike): boolean {
      const digest = hash(data)
  
      let sig: BufferLike
      if (typeof signature === "string") {
        sig = Convert.Base58.decodeBuffer(signature)
      } else {
        sig = signature
      }

      sig = Buffer.unpad(sig)
      // console.log(Convert.bufferToHex(Buffer.concat([0x30], sig)))
  
      return this.keyPair.verify(digest, Buffer.concat([0x30], sig))
    }
  
    toString(): string {
      return this.address
    }
    toJSON(): string {
      return this.address
    }
  }
  
  export class Private {
    private readonly keyPair: elliptic.ec.KeyPair
    private readonly stringRepresentation: string
  
    constructor(data: Private | string | BufferLike) {
      if (data instanceof Private) { return data }

      let buffer: BufferLike
      if (typeof data === "string") {
        buffer = Convert.Base58.decodeBuffer(data)
        this.stringRepresentation = data
      } else {
        buffer = data
        this.stringRepresentation = Convert.Base58.encode(data)
      }
  
      this.keyPair = ec.keyFromPrivate(buffer)
    }
  
    static generate(): Private {
      const keyPair = ec.genKeyPair()
      return new Private(keyPair.getPrivate().toArray())
    }
  
    private _cachedPublic: Public | null
    getPublic(): Public {
      if (this._cachedPublic) {
        return this._cachedPublic
      }
  
      const pub = this.keyPair.getPublic()
      const x = pub.getX()
      const y = pub.getY()
  
      const arr = x.toArray()
  
      const checksumBits = checksum(pub.encode("array", false), 127)
      const checkByte = (y.isOdd() ? 128 : 0) | checksumBits
      arr.push(checkByte)
  
      return new Public([1].concat(arr))
    }
  
    sign(data: string | BufferLike, fixedLength = false): Uint8Array {
      const digest = hash(data)
  
      const signature = this.keyPair.sign(digest).toDER().slice(1)
      // console.log(Convert.bufferToHex(this.keyPair.sign(digest).toDER()))
  
      if (fixedLength) {
        return Buffer.pad(signature, SIG_LENGTH)
      } else {
        return new Uint8Array(signature)
      }
    }
  
    derive(pub: Public | string | BufferLike): Uint8Array {
      const publicKey = new Public(pub)
      return new Uint8Array(this.keyPair.derive(publicKey["point"]).toArray())
    }

    exportEncrypted(password: string, salt: string, iterations: number): string
    exportEncrypted(password: string, salt: string, iterations: number, progressObj: { progress?: number, stop?: boolean }): Promise<string | null>
    exportEncrypted(password: string, salt: string, iterations: number, progressObj?: { progress?: number, stop?: boolean }): string | Promise<string | null> {
      let keyNum = this.keyPair.getPrivate()

      if (progressObj) {
        progressObj.progress = 0

        return kdfWithProgress(password + salt, iterations, progressObj).then(digest => {
          if (!digest) { return null }

          const passKey = new BN(digest.slice(0, 32))
          keyNum = keyNum.uxor(passKey)
          return Convert.Base58.encode(keyNum)
        })
      }

      const digest = kdf(password + salt, iterations)
      const passKey = new BN(digest.slice(0, 32))
      return Convert.Base58.encode(keyNum.uxor(passKey))
    }

    static importEncrypted(encryptedVal: string, password: string, salt: string, iterations: number): Private
    static importEncrypted(encryptedVal: string, password: string, salt: string, iterations: number, progressObj: { progress?: number, stop?: boolean }): Promise<Private | null>
    static importEncrypted(encryptedVal: string, password: string, salt: string, iterations: number, progressObj?: { progress?: number, stop?: boolean }): Private | Promise<Private | null> {
      const encryptedNum = Convert.Base58.decodeNumber(encryptedVal)

      if (progressObj) {
        return kdfWithProgress(password + salt, iterations, progressObj).then(digest => {
          if (!digest) { return null }

          const passKey = new BN(digest.slice(0, 32))
          return new Key.Private(encryptedNum.uxor(passKey).toArray())
        })
      }

      const digest = kdf(password + salt, iterations)
      const passKey = new BN(digest.slice(0, 32))
      return new Key.Private(encryptedNum.uxor(passKey).toArray())
    }
  
    toString(): string {
      return this.stringRepresentation
    }
    toJSON(): string {
      return this.stringRepresentation
    }
  }
}

export default Key