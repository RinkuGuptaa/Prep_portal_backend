const express = require('express');
const router = express.Router();
const {
  register,
  login,
  getMe
} = require('../Controllers/AuthController');
const { protect } = require('../Middlewares/Auth');
const {
  validateRegister,
  validateLogin
} = require('../Middlewares/AuthValidation');

router.post('/register', validateRegister, register);
router.post('/login', validateLogin, login);
router.get('/me', protect, getMe);

module.exports = router;