const Cryptoken = require('./classes/Cryptoken')
const express = require('express')
const cors = require('cors')
const axios = require('axios')

const bodyParser = require('body-parser')

// init server
const app = express()

app.use(cors())
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json())
app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", '*');
  res.header("Access-Control-Allow-Credentials", true);
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header("Access-Control-Allow-Headers", 'Origin,X-Requested-With,Content-Type,Accept,content-type,application/json');
  next();
});


app.get('/', async (req, res) => {
  return res.json({ 'message': 'Welcome to Cryptoken' })
})

app.get('/fetch_user/:user_id', async (req, res) => {
  const user_id = req.params.user_id
  try {
    const userWallet = await Cryptoken.fetchUserWallet(user_id)
    if (!userWallet)
      return res.status(404).json({ 'message': 'No user found in database' })
    return res.status(200).json(userWallet)
  } catch (err) {
    return res.status(500).json({ 'message': err })
  }
})

app.get('/launch_token', (req, res) => {
  new Cryptoken()
  return res.status(200).json({ message: 'Successfully Created' })
})

app.get('/launch_myr', async (req, res) => {
  try {
    const cryptoken = new Cryptoken(null, true)
    const transactionId = await cryptoken.myr_launch()
    if (transactionId)
      return res.status(200).json({ message: 'Successfully Created', transactionId })
    return res.status(200).json({ message: 'Already been created' })
  } catch (err) {
    console.log(err)
    return res.status(500).json({ message: err })
  }
})

const getUserWallet = async user_id => await Cryptoken.fetchUserWallet(user_id)

const validateBody = async (token, private_key, user_id, res) => {
  if (!token)
    return res.status(406).json({ message: 'amount not specified' })

  if (token < 1) {
    return res.status(406).json({ message: `amount must be bigger than 1: ${token}` })
  }

  if (!private_key)
    return res.status(406).json({ message: 'Private key not specified' })

  const userWallet = await getUserWallet(user_id)

  if (!userWallet)
    return res.status(404).json({ 'message': 'No user found in database' })

  if (!userWallet.private_key || !userWallet.public_key) {
    return res.status(406).json({ message: 'Please register first' })
  }

  return userWallet
}

app.post('/validatePrivateKey/:user_id', async (req, res) => {
  const { user_id } = req.params
  const { private_key } = req.body

  if (!user_id || !private_key) return res.status(406).json(false)
  try {
    const userWallet = await Cryptoken.fetchUserWallet(user_id)
    if (!userWallet) return res.status(400).json(false)

    const cryptoken = new Cryptoken(userWallet)
    try {
      const validated = await cryptoken.validatePrivateKey(private_key)
      return res.status(200).json(validated)
    } catch (err) {
      handleErrors(err, res)
    }
  } catch (err) {
    handleErrors(err, res)
  }
})

app.post('/deposit/:user_id', async (req, res) => {
  const { private_key, amount } = req.body
  const { user_id } = req.params
  const userWallet = await validateBody(amount, private_key, user_id, res)

  const cryptoken = new Cryptoken(userWallet)
  try {
    const depositResult = await cryptoken.deposit(amount, private_key)

    return res.status(200).json(depositResult)
  } catch (err) {
    return handleErrors(err, res)
  }
})

app.post('/withdraw/:user_id', async (req, res) => {
  const { private_key, amount } = req.body
  const { user_id } = req.params
  const userWallet = await validateBody(amount, private_key, user_id, res)

  const cryptoken = new Cryptoken(userWallet)
  try {
    const withdrarResult = await cryptoken.withdraw(amount, private_key)

    return res.status(200).json(withdrarResult)
  } catch (err) {
    return handleErrors(err, res)
  }
})

app.get('/register/:id', async (req, res) => {
  const user_id = req.params.id
  try {
    const userWallet = await Cryptoken.fetchUserWallet(user_id)

    if (!userWallet.private_key || !userWallet.public_key) {
      const keys = await Cryptoken.register(user_id)

      if (!keys)
        return res.status(406).json({ 'message': 'Something went wrong, please try again later' })

      return res.status(200).json(keys)
    }
  } catch (err) {
    return res.status(500).json({ 'message': err })
  }
})

app.get('/get_transactions/:key', async (req, res) => {
  const public_key = req.params.key
  try {
    const response = await axios.get(`${process.env.APP_URL}outputs?public_key=${public_key}`)

    if (response.data.length === 0)
      return res.status(response.status).json({ message: 'No transactions made' })

    return res.status(response.status).json(response.data)
  } catch (err) {
    console.log(err)
    if (err.response && err.response.data)
      return res.status(err.response.status).json(err.response.data)
    return res.status(err.response.status).json(err.response)
  }

})

app.post('/buy_token/:user_id', async (req, res) => {
  const { amount, private_key, myrAmount } = req.body
  const user_id = req.params.user_id

  const userWallet = await validateBody(amount, private_key, user_id, res)
  if (!myrAmount)
    return res.status(406).json({ message: 'No myrAmount specified' })

  const cryptoken = new Cryptoken(userWallet)
  // to avoid any unwanted error
  setTimeout(() => {
    cryptoken.buy_token(amount, private_key, myrAmount)
      .then(response => {
        return res.status(200).json(response)
      })
      .catch(err => {
        handleErrors(err, res)
      })
  }, 3000)
})

app.get('/getMyrCreatorTransactions', async (req, res) => {
  const cryptoken = new Cryptoken()
  try {
    const transactions = await cryptoken.getTokenCreatorTransaction(true)
    return res.status(200).json(transactions)
  } catch (err) {
    handleErrors(err, res)
  }
})

app.get('/currentToken/:public_key', async (req, res) => {
  const cryptoken = new Cryptoken()
  try {
    const token = await cryptoken.getCurrentToken(false, req.params.public_key)
    return res.status(200).json(token)
  } catch (err) {
    console.log(err)
    return handleErrors(err, res)
  }
})

app.post('/transferToken/:user_id', async (req, res) => {
  const { user_id } = req.params
  const { private_key, amount, to_key } = req.body

  if (parseInt(amount) < 1) return res.status(406).json({ message: 'Amount must be bigger than 1' })
  if (!private_key) return res.status(406).json({ message: 'No Private Key specified' })

  try {
    const userWallet = await getUserWallet(user_id)

    if (!userWallet) {
      return res.status(404).json({ message: `No user found with an ID of ${user_id}` })
    }
    const cryptoken = new Cryptoken(userWallet)

    const postedTransaction = await cryptoken.transfer_token(to_key, amount, private_key)

    return res.status(200).json(postedTransaction)
  } catch (err) {
    console.log(err)
    handleErrors(err, res)
  }
})

app.post('/sellToken/:user_id', async (req, res) => {
  const { user_id } = req.params
  const { private_key, amount, myr } = req.body

  if (parseInt(amount) < 1) return res.status(406).json({ message: 'Amount must be bigger than 1' })
  if (!private_key) return res.status(406).json({ message: 'No Private Key specified' })
  if (!myr) return res.status(406).json({ message: 'No MYR specified' })

  try {
    const userWallet = await getUserWallet(user_id)

    if (!userWallet) {
      return res.status(404).json({ message: `No user found with an ID of ${user_id}` })
    }
    const cryptoken = new Cryptoken(userWallet)

    const postedTransactionToken = await cryptoken.sell_token(amount, private_key)
    const postedTransactionMyr = await cryptoken.deposit(myr, private_key)

    return res.status(200).json({
      message: 'Transaction Successful',
      data: {
        transactions: [
          postedTransactionToken.id,
          postedTransactionMyr.id
        ]
      }
    })
  } catch (err) {
    console.log(err)
    handleErrors(err, res)
  }
})

app.get('/currentMyr/:public_key', async (req, res) => {
  const cryptoken = new Cryptoken()
  try {
    const token = await cryptoken.getCurrentToken(true, req.params.public_key)
    return res.status(200).json(token)
  } catch (err) {
    return handleErrors(err, res)
  }
})

const handleErrors = (error, res) => {
  if (error.config) return res.status(500).json(error.config)
  if (error.response) {
    // The request was made and the server responded with a status code
    // that falls out of the range of 2xx
    const { data, status, headers } = error.response
    console.log(data);
    console.log(status);
    console.log(headers);
    return res.status(status).json({ data })
  } else if (error.request) {
    const { request } = error
    console.log(request);
    return res.status(500).json({ request })
  } else {
    // Something happened in setting up the request that triggered an Error
    if (!error.message) return res.status(500).json(error)
    console.log('Error', error.message);
    return res.status(500).json(error.message)
  }
}



app.listen(process.env.PORT || 222, () => console.log('listening on heroku'))

// bcrypt.hash('BHVu2ijRffPULWr3BSfpD1PpQ8mFFtUxZLZXe2Qn8d32', 10, function (err, hash) {
//   // Store hash in your password DB.
//   if (err) throw err
//   console.log(hash)
// });

// bcrypt.compare('BHVu2ijRffPULWr3BSfpD1PpQ8mFFtUxZLZXe2Qn8d32', '$2b$10$H1HdNemnMWDHni26qfHBP.1BDzF.P5Ov9WmirJSKXb1oM2cWwJmv6')
//   .then(res => console.log(res))