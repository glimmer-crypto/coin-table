import Wallet from "./Wallet"
import CoinTable from "./CoinTable"
import Network from "./Network"
import { EventTarget, Buffer, Convert, deepClone } from "./utils"

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

          const newTable = await this.determineNewTable(this.table, table, from.address)
          if (!newTable) {
            if (newTable === false) {
              await this.network.shareTable(this.table)
            }

            return
          }

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
          console.log("confirmed", !!confirmed)
          const balanceConfirmed = await this.confirmBalance(transaction.sender)
          console.log("balance confirmed", balanceConfirmed)
          if (confirmed && balanceConfirmed) {
            this.table.applyTransaction(signed)
            this.dispatchEvent("transactioncompleted", deepClone(signed))

            this.network.shareTransaction(signed)
            confirmed(true)
            return signed
          } else if (confirmed) {
            confirmed(false)
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
  async determineNewTable(oldTable: CoinTable, newTable: CoinTable, from: string): Promise<CoinTable | false | null> {
    const oldBalances = oldTable.balances
    const mergedBalances: CoinTable.Balances = deepClone(oldBalances)

    const allAdresses = new Set<string>(oldTable.addresses)
    const disputedAddresses = new Set<string>()

    if (!newTable.isValid) {
      return false
    }

    const oldBurned = oldBalances.burned.amount
    const newBurned = newTable.balances.burned.amount
    if (oldBurned > newBurned) {
      mergedBalances.burned.amount = oldBurned
    } else {
      mergedBalances.burned.amount = newBurned
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
            disputedAddresses.add(walletAddress)
          }
        }

        if (!allAdresses.has(walletAddress)) {
          allAdresses.add(walletAddress)
          disputedAddresses.add(walletAddress)
        }
        missingAdresses.delete(walletAddress)
    })

    missingAdresses.forEach(missingAddress => {
      disputedAddresses.add(missingAddress)
    })

    let returnTable = new CoinTable(mergedBalances)
    if (returnTable.isValid) {
      if (Buffer.equal(returnTable.digest, oldTable.digest)) {
        return null
      } else {
        return returnTable
      }
    }

    const totalVotes = {
      old: 0,
      new: 0,
      other: 0,
      total: 0
    }
    const balanceVotes: Record<string, { old: number, new: number, other: number, total: number }> = {}

    const requiredVoters = 100
    let totalVoters = 0
    let pendingVotes: Promise<void>[] = []

    for (const connectedAddress of this.voters()) {
      if (connectedAddress === from) { continue }

      pendingVotes.push((async () => {
        const requests: Promise<void>[] = new Array(disputedAddresses.size)
  
        let addrIndex = 0
        disputedAddresses.forEach(disputedAddress => {
          const votes = {
            old: 0,
            new: 0,
            other: 0,
            total: 0
          }
          balanceVotes[disputedAddress] = votes

          requests[addrIndex] = (async () => {
            const response = await this.network.requestBalance(disputedAddress, connectedAddress, true)

            if (response === null) { return }
            if (response && !Wallet.verifyBalance(response, disputedAddress)) { return }

            const amount = response ? response.amount : undefined
            if (amount === oldTable.balances[disputedAddress]?.amount) {
              votes.old += 1
              totalVotes.old += 1
            } else if (amount === newTable.balances[disputedAddress]?.amount) {
              votes.new += 1
              totalVotes.new += 1
            } else {
              votes.other += 1
              totalVotes.other += 1
            }
            votes.total += 1
            totalVotes.total += 1

            totalVoters += 1
          })()

          addrIndex += 1
        })

        await Promise.all(requests)
      })())

      if (pendingVotes.length + totalVoters >= requiredVoters) {
        await Promise.all(pendingVotes)
        pendingVotes = []
      }
      if (totalVoters >= requiredVoters) { break }
    }
    await Promise.all(pendingVotes)

    console.log("Votes", totalVotes, balanceVotes)

    disputedAddresses.forEach(address => {
      const votes = balanceVotes[address]

      const majority = 0.75 * votes.total
      if (votes.new > majority) {
        mergedBalances[address] = newTable.balances[address]
      } else if (votes.old > majority) {
        mergedBalances[address] = oldBalances[address]
      } else {
        const oldAmount = oldBalances[address].amount
        const newAmount = newTable.balances[address].amount

        if (oldAmount > newAmount) {
          mergedBalances[address] = newTable.balances[address]
          mergedBalances.burned.amount += oldAmount - newAmount
        } else {
          mergedBalances[address] = oldBalances[address]
          mergedBalances.burned.amount += newAmount - oldAmount
        }
      }
    })

    returnTable = new CoinTable(mergedBalances)
    console.log(returnTable)
    if (returnTable.isValid) {
      return returnTable
    } else if (returnTable.coinSum < CoinTable.TOTAL_COINS) {
      mergedBalances.burned.amount += CoinTable.TOTAL_COINS - returnTable.coinSum
      returnTable = new CoinTable(mergedBalances)
      
      if (returnTable.isValid) {
        return returnTable
      }
    }

    return false

    // 3/4 majority
    if (totalVotes.new > 0.75 * totalVotes.total) {
      return newTable
    } else if (totalVotes.new > 0.5 * totalVotes.total) {
      return false
    } else {
      return false
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

  async confirmBalance(address: string): Promise<boolean> {
    const requiredVotes = 100
    let totalVotes = 0
    let affirmativeVotes = 0

    const thisBalance = this.table.balances[address]

    let pendingVotes: Promise<void>[] = []
    for (const connectedAddress of this.voters()) {
      if (connectedAddress === address) { continue }

      pendingVotes.push((async () => {
        const balance = await this.network.requestBalance(address, connectedAddress)
        if (balance === null) { return }

        totalVotes += 1
        if (balance === false) {
          if (!thisBalance) {
            affirmativeVotes += 1
          }
        } else if (
          balance.amount === thisBalance?.amount &&
          balance.timestamp === thisBalance?.timestamp &&
          balance.signature === thisBalance?.signature
        ) {
          affirmativeVotes += 1
        }
      })())

      if (pendingVotes.length + totalVotes >= requiredVotes) {
        await Promise.all(pendingVotes)
        pendingVotes = []
      }
      if (totalVotes >= requiredVotes) { break }
    }
    await Promise.all(pendingVotes)

    if (affirmativeVotes >= totalVotes * 0.75) {
      return true
    } else {
      return false
    }
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

  *voters(): Generator<string, void, unknown> {
    let stakePool = 0
    const voters: { address: string, stake: number }[] = []
    this.network.connectedAddresses.forEach(address => {
      const stake = this.table.balances[address]?.amount
      if (stake) {
        voters.push({
          address, stake
        })
        stakePool += stake
      }
    })

    console.log(voters)

    const count = voters.length
    for (let i = 0; i < count; i++) {
      let voterIndex = 0
      let voter: { address: string, stake: number } | null = null

      const selection = Math.random() * stakePool
      for (let i = 0, accumulator = 0; i < voters.length; i++) {
        voterIndex = i
        voter = voters[i]
        accumulator += voter.stake

        if (accumulator > selection) { break }
      }

      if (!voter) { return }

      yield voter.address
      stakePool -= voter.stake
      voters.splice(voterIndex, 1)
    }
  }
}