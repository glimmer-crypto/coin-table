import type CoinTable from "./CoinTable"
import type Node from "./Node"
import { Convert, deepClone, Buffer } from "./utils"
import Key from "./Key"

class Wallet {
  readonly public: Key.Public
  readonly private: Key.Private
  node: Node

  constructor(privateKey: string | Key.Private, publicAddress?: string | Key.Public) {
    if (typeof privateKey === "string") {
      this.private = new Key.Private(privateKey)
    } else {
      this.private = privateKey
    }

    this.public = this.private.getPublic()
    
    if (typeof publicAddress === "string") {
      if (publicAddress !== this.public.address) {
        throw new Error("Public address incompatible with the private key")
      }
    } else if (publicAddress) {
      if (publicAddress.address !== this.public.address) {
        throw new Error("Public address incompatible with the private key")
      }
    }
  }

  signBalance(balance: CoinTable.Balance): CoinTable.SignedBalance {
    const balanceCopy = deepClone(balance) as CoinTable.SignedBalance

    const balanceBuf = Buffer.concat(
      Convert.int64ToBuffer(balance.amount),
      Convert.int64ToBuffer(balance.timestamp),
    )

    const signature = this.private.sign(balanceBuf)
    balanceCopy.signature = Convert.Base58.encode(signature)

    return balanceCopy
  }

  static verifyBalance(balance: CoinTable.SignedBalance, publicKey: Key.Public | string): boolean {
    const key = new Key.Public(publicKey)
    const balanceBuf = Buffer.concat(
      Convert.int64ToBuffer(balance.amount),
      Convert.int64ToBuffer(balance.timestamp),
    )
    return key.verify(balanceBuf, balance.signature)
  }

  createTransaction(amount: number, reciever: Key.Public | string): CoinTable.PendingTransaction {
    if (!this.node.table) { throw new Error("Missing current table") }

    const recieverKey = new Key.Public(reciever)
    if (recieverKey.address === this.public.address) { throw new Error("Cannot create a transaction with yourself") }
    
    const currentBalance = this.node.table.balances[this.public.address]
    const currentAmount = currentBalance?.amount ?? 0

    if (amount == 0) { throw new TypeError("Transaction must have a non-zero amount") }
    if (amount % 1 !== 0) { throw new TypeError("Transaction must have an integer amount") }

    if (amount > currentAmount) { throw new RangeError("Insufficient balance") }

    const timestamp = Date.now()

    const newBalance = {
      amount: currentAmount - amount,
      timestamp
    }
    const signature = this.signBalance(newBalance).signature

    const transactionBuf = Buffer.concat(
      Convert.int64ToBuffer(amount),
      Convert.int64ToBuffer(timestamp),
      Convert.Base58.decodeBuffer(recieverKey.address)
    )

    const transaction: CoinTable.PendingTransaction = {
      amount, timestamp,

      sender: this.public.address,
      reciever: recieverKey.address,
      
      senderSignature: signature,
      senderTransactionSignature: Convert.Base58.encode(this.private.sign(transactionBuf))
    }

    return transaction
  }

  signTransaction(transaction: CoinTable.PendingTransaction): CoinTable.SignedTransaction {
    if (!this.node?.table) { throw new Error("Missing current table") }
    if (transaction.reciever !== this.public.address) { throw new Error("Cannot sign transaction, not the recipient") }

    transaction = deepClone(transaction)

    const currentBalance = this.node.table.balances[this.public.address]
    const currentAmount = currentBalance?.amount ?? 0
    const lastTransactionTimestamp = currentBalance?.timestamp ?? 0

    if (transaction.timestamp <= lastTransactionTimestamp) { throw new Error("Invalid transaction timestamp") }

    const amount = transaction.amount
    if (amount % 1 !== 0 || amount < 1) { throw new Error("Invalid transaction amount") }

    const transactionBuf = Buffer.concat(
      Convert.int64ToBuffer(amount),
      Convert.int64ToBuffer(transaction.timestamp),
      Convert.Base58.decodeBuffer(transaction.reciever)
    )
    const verified = new Key.Public(transaction.sender).verify(transactionBuf, transaction.senderTransactionSignature)
    if (!verified) { throw new Error("Unable to verify transaction") }

    const newBalance = {
      amount: currentAmount + amount,
      timestamp: transaction.timestamp
    }

    transaction.recieverSignature = this.signBalance(newBalance).signature
    return transaction as CoinTable.SignedTransaction
  }

  signMessage(buf: Uint8Array): Uint8Array {
    const signature = this.private.sign(buf, true)

    const concatBuffer = Buffer.concat(signature, buf)
    return concatBuffer
  }

  static verifyMessage(buf: Uint8Array, from: Key.Public | string): { verified: boolean, originalMessage: Uint8Array } {
    const publicKey = new Key.Public(from)

    const signature = buf.slice(0, Key.SIG_LENGTH)
    const originalMessage = buf.slice(Key.SIG_LENGTH)

    const verified = publicKey.verify(originalMessage, signature)

    return { verified, originalMessage }
  }

  static generate(): Wallet {
    return new Wallet(Key.Private.generate())
  }

  isValid(): boolean {
    const testMessage = "test " + Math.random().toString()

    const signature = this.private.sign(testMessage)
    return this.public.verify(testMessage, signature)
  }

  static importJSON(json: Wallet.JSONObject | string, password?: string): Wallet
  static importJSON(json: Wallet.JSONObject | string, password: string, progressObj: { progress?: number, stop?: boolean }): Promise<Wallet | null>
  static importJSON(json: Wallet.JSONObject | string, password?: string, progressObj?: { progress?: number, stop?: boolean }): Wallet | Promise<Wallet | null> {
    let jsonObj = json as Wallet.JSONObject
    if (typeof json === "string") { jsonObj = JSON.parse(json) }

    if (jsonObj.salt) {
      if (!password) { throw new Error("Missing password") }

      const hashIterations = typeof jsonObj.iterations === "number" ? jsonObj.iterations : defaultPasswordHashIterations

      if (progressObj) {
        return Key.Private.importEncrypted(jsonObj.privateKey, password, jsonObj.salt, hashIterations, progressObj).then(privateKey => {
          if (!privateKey) { return null }

          return new Wallet(privateKey, jsonObj.publicAddress)
        })
      }

      const privateKey = Key.Private.importEncrypted(jsonObj.privateKey, password, jsonObj.salt, hashIterations)
      return new Wallet(privateKey, jsonObj.publicAddress)
    }

    const wallet = new Wallet(jsonObj.privateKey, jsonObj.publicAddress)
    return wallet
  }

  exportJSON(password?: string, iterations?: number): Wallet.JSONObject
  exportJSON(password: string, iterations: number | undefined | null, progressObj: { progress?: number }): Promise<Wallet.JSONObject | null>
  exportJSON(password?: string, iterations?: number, progressObj?: { progress?: number }): Wallet.JSONObject | Promise<Wallet.JSONObject | null>  {
    const hashIterations = iterations ?? defaultPasswordHashIterations

    if (password) {
      const salt = Math.random().toString(36).slice(2)

      if (progressObj) {
        return this.private.exportEncrypted(password, salt, hashIterations, progressObj).then(privateKey => {
          if (!privateKey) { return null }
          
          return {
            publicAddress: this.public.address,
            privateKey: privateKey,
            salt,
            iterations: hashIterations
          }
        })
      }

      return {
        publicAddress: this.public.address,
        privateKey: this.private.exportEncrypted(password, salt, hashIterations),
        salt,
        iterations: hashIterations
      }
    }

    if (progressObj) {
      progressObj.progress = 1
      return new Promise(r => r({
        publicAddress: this.public.address,
        privateKey: this.private.toString()
      }))
    }

    return {
      publicAddress: this.public.address,
      privateKey: this.private.toString()
    }
  }
}

const defaultPasswordHashIterations = 15_000

namespace Wallet {
  export type JSONObject = {
    publicAddress?: string,
    privateKey: string,
    salt?: string,
    iterations?: number
  }
}

export default Wallet