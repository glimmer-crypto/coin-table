import Wallet from "./Wallet"
import CoinTable from "./CoinTable"
import Network from "./Network"
import { EventTarget, Buffer, Convert, deepClone, shuffle } from "./utils"

type NodeEvents = {
  "transactioncompleted": CoinTable.SignedTransaction,
  "newtable": CoinTable
}

interface NetworkDelegate {
  signPendingTransaction(transaction: CoinTable.PendingTransaction, from: string): Promise<false | CoinTable.SignedTransaction>
  processTransaction(transaction: CoinTable.SignedTransaction): Promise<void>
  confirmPendingTransaction(transaction: Omit<CoinTable.PendingTransaction, "senderSignature">, castVote: ((vote: true) => Promise<boolean>) & ((vote: false) => void)): void
}

export default class Node extends EventTarget<NodeEvents> implements NetworkDelegate {
  readonly wallet: Wallet
  readonly network: Network
  table: CoinTable

  constructor(wallet: Wallet, network: Network, initalTable?: CoinTable) {
    super()

    this.wallet = wallet
    wallet.node = this

    this.network = network
    network.node = this

    this.table = initalTable ?? CoinTable.initialTable
    if (!this.table.isValid) { throw new Error("Initial table must be valid") }

    this.initNetwork()
  }

  private initNetwork() {
    this.network.on("tabledigest", ({ digest, from }) => {
      this.addToQueue(async () => {
        if (!Buffer.equal(digest, this.table.digest)) {
          const table = await this.network.requestTable(from.address, from.id)
          if (!table) { return }

          const newTable = await this.determineNewTable(this.table, table)
          if (!newTable) { return }

          this.table = newTable
          this.network.shareTable(newTable)
          this.dispatchEvent("newtable", newTable)
        }
      })
    })
  }

  // Network delegate methods

  async signPendingTransaction(transaction: CoinTable.PendingTransaction, from: string): Promise<false | CoinTable.SignedTransaction> {
    const myAddress = this.wallet.public.address
    const currentBalance = this.table.balances[myAddress] ?? { timestamp: 0 }
    if (transaction.reciever === myAddress && transaction.sender === from && transaction.timestamp > currentBalance.timestamp) {
      return this.addToQueue(async () => {
        try {
          const signed = this.wallet.signTransaction(transaction)
          
          const confirmed = await this.network.confirmTransaction(signed)
          // console.log("confirmed", confirmed)
          if (confirmed) {
            this.table.applyTransaction(signed)
            this.dispatchEvent("transactioncompleted", deepClone(signed))

            this.network.shareTransaction(signed)
            return signed
          }
        } catch (err) {
          console.error(err)
          return false
        }

        return false
      })
    }

    return false
  }

  pendingTransactions = new Set<string>()
  async confirmPendingTransaction(transaction: CoinTable.ConfirmationTransaction, castVote: (vote: boolean) => Promise<boolean>): Promise<void> {
    if (!Wallet.verifyConfirmationTransaction(transaction)) {
      castVote(false)
      return
    }

    const pendingTransactions = this.pendingTransactions

    if (pendingTransactions.has(transaction.sender)) {
      castVote(false)
    } else {
      pendingTransactions.add(transaction.sender)
      await castVote(true)
      pendingTransactions.delete(transaction.sender)
    }
  }

  processTransaction(transaction: CoinTable.SignedTransaction): Promise<void> {
    return this.addToQueue(() => {
      try {
        this.table.applyTransaction(transaction)
        this.network.shareTransaction(transaction)

        this.retryFailedTransactions(transaction)

        this.dispatchEvent("transactioncompleted", deepClone(transaction))
        console.log("Transaction completed successfully")
      } catch (err) {
        if (!err.message.includes("Transaction timestamp is invalid")) {
          if (!this.failedTransactions[transaction.sender]) {
            this.failedTransactions[transaction.sender] = [transaction]
          } else {
            this.failedTransactions[transaction.sender].push(transaction)
          }

          if (!this.failedTransactions[transaction.reciever]) {
            this.failedTransactions[transaction.reciever] = [transaction]
          } else {
            this.failedTransactions[transaction.reciever].push(transaction)
          }

          console.error(err)
        }
      }
    })
  }



  /**
   * @returns A `CoinTable` if there is a new table and `null` if not
   */
  async determineNewTable(oldTable: CoinTable, newTable: CoinTable): Promise<CoinTable | null> {
    const oldBalances = oldTable.balances
    const mergedBalances: CoinTable.Balances = deepClone(oldBalances)

    const allAdresses = new Set<string>(oldTable.addresses)
    const disputedAdresses = new Set<string>()

    if (!newTable.isValid) {
      return null
    }

    const missingAdresses = new Set(allAdresses)
    newTable.addresses.list.forEach(walletAddress => {
      const balance = newTable.balances[walletAddress]

        const currentBalance = mergedBalances[walletAddress]
        if (!currentBalance) {
          mergedBalances[walletAddress] = balance
        } else if (currentBalance.timestamp < balance.timestamp) {
          mergedBalances[walletAddress] = balance
          if (currentBalance.amount !== balance.amount) {
            disputedAdresses.add(walletAddress)
          }
        }

        if (!allAdresses.has(walletAddress)) {
          allAdresses.add(walletAddress)
          disputedAdresses.add(walletAddress)
        }
        missingAdresses.delete(walletAddress)
    })

    missingAdresses.forEach(missingAddress => {
      disputedAdresses.add(missingAddress)
    })

    const returnTable = new CoinTable(mergedBalances)
    if (returnTable.isValid) {
      if (Buffer.equal(returnTable.digest, oldTable.digest)) {
        return null
      } else {
        return returnTable
      }
    }

    const myVotes = disputedAdresses.size * Math.sqrt(oldBalances[this.wallet.public.address]?.amount ?? 0)
    const votes = {
      old: myVotes,
      new: 0,
      other: 0,
      total: 0
    }

    const connectedAdresses = shuffle(Array.from(this.network.connectedAddresses))
    const requiredVoters = 100
    let totalVoters = 0

    for (let i = 0; i < connectedAdresses.length;) {
      const remainingVoters = requiredVoters - totalVoters
      let pendingVoters = 0
      const pendingVotes: Promise<void>[] = []

      while (pendingVoters < remainingVoters && i < connectedAdresses.length) {
        const connectedAddress = connectedAdresses[i]
        i += 1

        if (connectedAddress === this.wallet.public.address || !allAdresses.has(connectedAddress)) { continue }

        const votingPower = this.votingPower(connectedAddress)
        if (!votingPower) { continue }

        pendingVoters += 1
        pendingVotes.push(((async () => {
          const requests: Promise<void>[] = new Array(disputedAdresses.size)
  
          let addrIndex = 0
          disputedAdresses.forEach(disputedAddress => {
            addrIndex += 1

            requests[addrIndex] = (async () => {
              const response = await this.network.requestBalance(disputedAddress, connectedAddress)

              if (response === null) { return }

              const amount = response ? response.amount : undefined
              if (amount === oldTable.balances[disputedAddress]?.amount) {
                votes.old += votingPower
              } else if (amount === newTable.balances[disputedAddress]?.amount) {
                votes.new += votingPower
              } else {
                votes.other += votingPower
              }
              votes.total += votingPower

              totalVoters += 1
            })()
          })
  
          await Promise.all(requests)
        })()))
      }

      await Promise.all(pendingVotes)
    }

    console.log("Votes", this.wallet.public.address.slice(0, 8), votes)

    // 3/4 majority
    if (votes.new >= 0.75 * votes.total) {
      return newTable
    } else {
      return null
    }
  }

  private failedTransactions: { [address: string]: CoinTable.SignedTransaction[] } = {}
  private retryFailedTransactions(transaction: CoinTable.SignedTransaction) {
    [transaction.sender, transaction.reciever].forEach(addr => {
      const failed = this.failedTransactions[addr]
      if (!failed) { return }

      failed.sort((a, b) => a.timestamp - b.timestamp)
      for (let i = 0; i < failed.length; i++) {
        const failedTransaction = failed[i]
        if (failedTransaction.timestamp <= transaction.timestamp) {
          failed.splice(i, 1)
          i -= 1
        } else {
          try {
            this.table.applyTransaction(failedTransaction)
            failed.splice(i, 1)
            i -= 1

            this.dispatchEvent("transactioncompleted", deepClone(transaction))
          } catch (err) {
            break
          }
        }
      }
    })
  }

  async sendTransaction(amount: number, reciever: string): Promise<boolean | null> {
    reciever = Convert.Base58.normalize(reciever)
    return this.addToQueue(async () => {
      console.log("sending transaction", amount, reciever)
      const transaction = this.wallet.createTransaction(amount, reciever)
      const signed = await this.network.sendPendingTransaction(transaction)

      if (signed) {
        try {
          const valid = this.wallet.verifyTransaction(signed)
          if (!valid) { return false }

          this.table.applyTransaction(signed)
          this.dispatchEvent("transactioncompleted", deepClone(signed))

          this.network.shareTransaction(signed)
          return true
        } catch (err) {
          console.error(err)
        }
      } else {
        return signed as false | null
      }

      return false
    })
  }

  getTable(): Promise<CoinTable | null> {
    return this.addToQueue(() => this.table)
  }

  private queue: Promise<unknown>[] = []
  private addToQueue<T>(action: () => (Promise<T> | T)): Promise<T> {
    let actionPromise: Promise<T>
    if (this.queue[0]) {
      actionPromise = this.queue[0].then(() => action(), err => { console.error(err); return err })
    } else {
      actionPromise = (async () => {
        try {
          return action()
        } catch (err) {
          console.error(err)
          return err
        }
      })()
    }

    this.queue.unshift(actionPromise)
    if (this.queue.length > 1) { this.queue.pop() }

    return actionPromise
  }

  votingPower(address: string): number {
    const balance = this.table.balances[address]

    if (!balance?.amount) {
      return 0
    } else {
      return Math.sqrt(balance.amount)
    }
  }
}