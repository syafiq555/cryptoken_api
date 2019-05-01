// Require dependencies.
const driver = require('bigchaindb-js-driver');
const bip39 = require('bip39')
const axios = require('axios')
const bcrypt = require('bcryptjs')

// Require the dotenv library.
require('dotenv').config()

const DB = require('../dbConnection/Connection')

class Cryptoken {
  // the properties available
  /**
   * Initialise a new class that we'll use to handle our connection with the network.
   */
  constructor(wallet = null, myr = false) {
    // Initialise a new connection.
    this.connection = new driver.Connection(process.env.APP_URL);
    this.tokenCreator = Cryptoken.generateKeypair(process.env.SEED_PHRASE)
    this.myrCreator = Cryptoken.generateKeypair(process.env.MYR_SEED_PHRASE)
    if (wallet)
      this.currentWallet = wallet
    if (!myr)
      this.firstLaunch()
  }

  myr_launch() {
    return new Promise(async (resolve, reject) => {
      try {
        const transaction = await this.getTokenCreatorTransaction(true)
        const totalMyr = 1000000000000
        if (!transaction) {
          const createTransaction =
            driver.Transaction.makeCreateTransaction(
              { amount: totalMyr.toString(), currency: `${totalMyr.toString()} MYR` },
              { description: `MYR_ORIGIN` },
              [
                driver.Transaction.makeOutput(
                  driver.Transaction.makeEd25519Condition(this.myrCreator.publicKey),
                  totalMyr.toString()
                )
              ],
              this.myrCreator.publicKey
            )

          const signTransaction =
            driver.Transaction.signTransaction(createTransaction, this.myrCreator.privateKey)
          try {
            const postedTransaction =
              await this.connection.postTransactionCommit(signTransaction)
            return resolve(postedTransaction.id)
          } catch (err) {
            console.log('error in committing transaction', err)
            return reject(err)
          }
        } else {
          return resolve(null)
        }
      } catch (err) {
        console.log('There\'s something wrong!', err)
        return reject(err)
      }
    })
  }

  static fetchUserWallet(user_id) {
    return new Promise(async (resolve, reject) => {
      await DB.query(`
        SELECT *
        FROM wallets
        WHERE user_id=${user_id}
      `, (err, [wallet]) => {
          if (err) reject(err)
          resolve(wallet)
        })
    })
  }

  static async register() {
    const { privateKey, publicKey } = Cryptoken.generateKeypair()
    const hashedPrivateKey = await Cryptoken.hashKey(privateKey)
    return { privateKey, publicKey, hashedPrivateKey }
  }

  async firstLaunch() {
    try {
      const results = await axios.get(`${process.env.APP_URL}outputs`, {
        params: {
          public_key: this.tokenCreator.publicKey
        }
      })

      const { data } = results

      if (!data.length) {
        try {
          const transaction = await this.tokenLaunch()
          console.log(transaction)
        } catch (err) {
          this.handleErrors(err)
        }
      }

    } catch (err) {
      this.handleErrors(err)
    }
  }
  // Handling axios errors
  handleErrors(error) {
    if (!error.response) {
      console.log(error)
    }

    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.log(error.response.data);
      console.log(error.response.status);
      console.log(error.response.headers);
    } else if (error.request) {
      // The request was made but no response was received
      // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
      // http.ClientRequest in node.js
      console.log(error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.log('Error', error.message);
    }
    console.log(error.config);
  }

  static hashKey(key) {
    return new Promise((resolve, reject) => {
      bcrypt.hash(key, 10, function (err, hash) {
        // Store hash in your password DB.
        if (err) reject(err)
        resolve(hash)
      });
    })
  }

  /**
   * Generate a keypair based on the supplied seed string.
   * @param {string} keySeed - The seed that should be used to generate the keypair.
   * @returns {*} The generated keypair.
   */
  static generateKeypair(keySeed = '') {
    if (!keySeed) return new driver.Ed25519Keypair();
    return new driver.Ed25519Keypair(bip39.mnemonicToSeedSync(keySeed).slice(0, 32));
  }

  tokenLaunch() {
    return new Promise((resolve, reject) => {
      if (!this.tokenCreator.publicKey) reject('Token creator public key is undefined')
      const tokenCreator = this.tokenCreator
      // total token
      this.total_token = 1000000000000
      // assetData
      const assetData = {
        token: 'CTOKEN (Cryptoken) V3',
        number_tokens: this.total_token
      }
      // meta data
      const metaData = {
        datetime: new Date().toString()
      }
      // create token
      const createTokenTransaction =
        driver.Transaction.makeCreateTransaction(
          assetData,
          metaData,
          [
            driver.Transaction.makeOutput(
              driver.Transaction.makeEd25519Condition(tokenCreator.publicKey),
              this.total_token.toString()
            )
          ],
          tokenCreator.publicKey
        )
      // sign transactions
      const transactionSigned = driver.Transaction.signTransaction(
        createTokenTransaction,
        tokenCreator.privateKey
      )
      // post to network
      this.connection.postTransactionCommit(transactionSigned)
        // .then resolve
        .then(res => resolve(res))
        // .catch reject
        .catch(err => reject(err))
    })
  }

  getTokenCreatorTransaction(myr = false, public_key = '') {
    return new Promise((resolve, reject) => {
      axios.get(`
        ${process.env.APP_URL}outputs?public_key=${public_key ? public_key : !myr && !public_key
          ? this.tokenCreator.publicKey
          : this.myrCreator.publicKey}&spent=false
      `)
        .then(async (res) => {
          if (!res.data.length) return resolve(null)
          return resolve(res.data)
        })
        .catch(err => {
          if (err.response && err.response.data)
            return reject(err.response.data)
          return reject(err)
        })
    })
  }

  async validatePrivateKey(private_key) {
    try {
      const result = await bcrypt.compare(private_key, this.currentWallet.private_key)
      return result
    } catch (err) {
      return err
    }
  }

  getCurrentToken(myr = false, public_key = '') {
    return new Promise((resolve, reject) => {
      this.getTokenCreatorTransaction(myr, public_key)
        .then(async txs => {
          if (!txs) return resolve(0)
          const transactionsID = txs.map(tx => tx.transaction_id)
          const transactionsRes = transactionsID.map(async id => {
            try {
              return await this.connection.getTransaction(id)
            } catch (err) {
              return reject(err)
            }
          })

          try {
            const transactions = !myr ?
              (await Promise.all(transactionsRes)).filter(tx => !tx.metadata.description) :
              (await Promise.all(transactionsRes)).filter(tx => tx.metadata.description)

            const amount = transactions.reduce((acc, tx) => {
              if (public_key) {
                const [{ amount }] = tx.outputs.filter(output => output.public_keys.join() === public_key)

                return acc += parseInt(amount)
              }

              if (myr) {
                const [{ amount }] = tx.outputs.filter(output => output.public_keys.join() === this.myrCreator.publicKey)
                return acc += parseInt(amount)
              }

              const [{ amount }] = tx.outputs.filter(output => output.public_keys.join() === this.tokenCreator.publicKey)
              return acc += parseInt(amount)
            }, 0)

            return resolve(amount)
          } catch (err) {
            return reject(err)
          }
        })
        .catch(err => reject(err))
    })
  }

  getUnspentInputs(myr = false, public_key = '', ) {
    return new Promise(async (resolve, reject) => {
      try {
        const myrUnspentInputsPromise =
          (await this.getTokenCreatorTransaction(myr, public_key))
            .map(async tx => {
              const txDetails = await this.connection.getTransaction(tx.transaction_id)
              if (myr) {
                if (!txDetails.metadata.description)
                  return null
                return { tx: txDetails, output_index: tx.output_index }
              } else {
                if (txDetails.metadata.description) return null
                return { tx: txDetails, output_index: tx.output_index }
              }
            })
            .filter(async tx => (await tx) !== null)

        const myrUnspentInputs = (await Promise.all(myrUnspentInputsPromise)).filter(tx => tx !== null)
        return resolve(myrUnspentInputs)
      } catch (err) {
        this.handleErrors(err)
        return reject(err)
      }
    })
  }

  withdraw(amount, private_key) {
    return new Promise(async (resolve, reject) => {
      try {
        const isValid = await this.validatePrivateKey(private_key)
        if (!isValid)
          return reject('Incorrect private_key')

        const fromCurrentToken = await this.getCurrentToken(true, this.currentWallet.public_key)
        const tokenLeft = parseInt(fromCurrentToken) - parseInt(amount)

        const metaData = {
          description: `Withdrew MYR ${amount} at ${new Date().toString()}`
        }

        const unspentInputs = await this.getUnspentInputs(true, this.currentWallet.public_key)
        const postedTransaction = await this.makeTransferTransaction(
          unspentInputs,
          amount,
          tokenLeft,
          this.currentWallet.public_key,
          private_key,
          this.myrCreator.publicKey,
          metaData
        )

        return resolve(postedTransaction)
      } catch (err) {
        this.handleErrors(err)
        return reject(err)
      }
    })
  }

  transfer_token(to_key, amount, private_key) {
    return new Promise(async (resolve, reject) => {
      try {
        const isValid = await this.validatePrivateKey(private_key)
        if (!isValid)
          return reject('Incorrect private_key')

        const fromCurrentToken = await this.getCurrentToken(false, this.currentWallet.public_key)
        const tokenLeft = parseInt(fromCurrentToken) - parseInt(amount)

        const metaData = {
          transfer_to: to_key,
          from: this.currentWallet.public_key,
          tokens_left: tokenLeft,
          token: 'CTOKEN (Cryptoken)'
        }

        const unspentInputs = await this.getUnspentInputs(false, this.currentWallet.public_key)
        const postedTransaction = await this.makeTransferTransaction(
          unspentInputs,
          amount,
          tokenLeft,
          this.currentWallet.public_key,
          private_key,
          to_key,
          metaData
        )

        return resolve(postedTransaction)
      } catch (err) {
        this.handleErrors(err)
        return reject(err)
      }
    })
  }

  sell_token(amount, private_key) {
    return new Promise(async (resolve, reject) => {
      try {
        const isValid = await this.validatePrivateKey(private_key)
        if (!isValid)
          return reject('Incorrect private_key')

        const fromCurrentToken = await this.getCurrentToken(false, this.currentWallet.public_key)
        const tokenLeft = parseInt(fromCurrentToken) - parseInt(amount)

        const metaData = {
          transfer_to: this.tokenCreator.publicKey,
          from: this.currentWallet.public_key,
          tokens_left: tokenLeft,
          token: 'CTOKEN (Cryptoken)'
        }

        const unspentInputs = await this.getUnspentInputs(false, this.currentWallet.public_key)
        const postedTransaction = await this.makeTransferTransaction(
          unspentInputs,
          amount,
          tokenLeft,
          this.currentWallet.public_key,
          private_key,
          this.tokenCreator.publicKey,
          metaData
        )

        return resolve(postedTransaction)
      } catch (err) {
        this.handleErrors(err)
        return reject(err)
      }
    })
  }

  buy_token(amount, private_key, myrAmount) {
    return new Promise((resolve, reject) => {
      if (!private_key) reject({ message: 'No private key specified', status: 406 })

      this.validatePrivateKey(private_key)
        .then(valid => {
          if (!valid) reject({ message: 'Private key not valid', status: 406 })
          this.getCurrentToken()
            .then(async currentToken => {
              const tokensLeft = currentToken - amount
              //  set meta data
              const metaData = {
                //  transfer_to
                transfer_to: this.currentWallet.public_key,
                //  tokens_left
                tokens_left: tokensLeft,
                token: 'CTOKEN (Cryptoken)'
              }

              //  get the whole transaction based on i
              try {
                const unspentInputs = await this.getUnspentInputs()

                const currentWalletMyr = await this.getCurrentToken(true, this.currentWallet.public_key)

                const myrUnspentInputs = await this.getUnspentInputs(true, this.currentWallet.public_key)
                const myrLeft = parseInt(currentWalletMyr) - parseInt(myrAmount)

                const myrMetaData = {
                  description: `Exchanged MYR ${myrAmount} on ${new Date().toString()}`
                }

                const postedTransaction = await this.makeTransferTransaction(
                  unspentInputs,
                  amount,
                  tokensLeft,
                  this.tokenCreator.publicKey,
                  this.tokenCreator.privateKey,
                  this.currentWallet.public_key,
                  metaData
                )

                if (postedTransaction) {
                  try {
                    await this.makeTransferTransaction(
                      myrUnspentInputs,
                      myrAmount,
                      myrLeft,
                      this.currentWallet.public_key,
                      private_key,
                      this.myrCreator.publicKey,
                      myrMetaData
                    )
                  } catch (err) {
                    this.handleErrors(err)
                    return reject(err)
                  }
                }
                return resolve(postedTransaction)

              } catch (err) {
                return reject(err)
              }
            }).catch(err => reject(err))
        }).catch(err => reject(err))
    })
  }

  deposit(amount, private_key) {
    return new Promise(async (resolve, reject) => {
      try {
        const currentMyr = await this.getCurrentToken(true)
        const myrLeft = parseInt(currentMyr) - parseInt(amount)
        const validated = await this.validatePrivateKey(private_key)
        if (!validated)
          return reject('Wrong private key')

        const myrUnspentInputsPromise =
          (await this.getTokenCreatorTransaction(true))
            .map(async tx => {
              const txDetails = await this.connection.getTransaction(tx.transaction_id)
              if (!txDetails.metadata.description)
                return null
              return { tx: txDetails, output_index: tx.output_index }
            })
            .filter(async tx => (await tx) !== null)



        const myrUnspentInputs = (await Promise.all(myrUnspentInputsPromise)).filter(tx => tx !== null)

        const metaData = { description: `Deposit MYR ${amount} on ${new Date().toString()}` }

        try {
          const postedTransaction = await this.makeTransferTransaction(
            myrUnspentInputs,
            amount,
            myrLeft.toString(),
            this.myrCreator.publicKey,
            this.myrCreator.privateKey,
            this.currentWallet.public_key,
            metaData
          )

          return resolve(postedTransaction)
        } catch (err) {
          return reject(err)
        }
      } catch (err) {
        if (err.response && err.response.data)
          return reject(err.response.data)
        if (err.response)
          return reject(err.response)
        return reject(err)
      }
    })
  }

  makeTransferTransaction(unspentInputs, amount, amountLeft, from_key, from_private, to_key, metaData) {
    return new Promise(async (resolve, reject) => {
      const createTransferTransaction = amountLeft != 0 ?
        driver.Transaction.makeTransferTransaction(
          unspentInputs,
          [
            driver.Transaction.makeOutput(
              driver.Transaction.makeEd25519Condition(from_key),
              (amountLeft).toString()
            ),
            driver.Transaction.makeOutput(
              driver.Transaction.makeEd25519Condition(to_key),
              (amount).toString()
            ),
          ],
          metaData
        ) : driver.Transaction.makeTransferTransaction(
          unspentInputs,
          [
            driver.Transaction.makeOutput(
              driver.Transaction.makeEd25519Condition(to_key),
              (amount).toString()
            ),
          ],
          metaData
        )

      const signedTransactionParameters = unspentInputs.reduce(acc => [...acc, from_private], [createTransferTransaction])

      const signedTransaction =
        driver.Transaction.signTransaction(...signedTransactionParameters)

      try {
        const postedTransaction = await this.connection.postTransactionCommit(signedTransaction)
        resolve(postedTransaction)
      } catch (err) {
        return reject(err)
      }
    })
  }
}

// Create exports to make some functionality available in the browser.

module.exports = Cryptoken