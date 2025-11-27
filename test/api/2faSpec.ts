/*
 * Copyright (c) 2014-2026 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import * as frisby from 'frisby'
import config from 'config'
import jwt from 'jsonwebtoken'
import * as otplib from 'otplib'
import * as security from '../../lib/insecurity'

const Joi = frisby.Joi

const REST_URL = process.env.API_BASE_URL + '/rest'
const API_URL = process.env.API_BASE_URL + '/api'

const jsonHeader = { 'content-type': 'application/json' }

async function login ({ email, password, totpSecret }) {
  try {
    const loginRes = await frisby.post(`${REST_URL}/user/login`, { email, password })

    if (loginRes.json?.status === 'totp_token_required') {
      const totpToken = otplib.authenticator.generate(totpSecret || process.env.TOTP_SECRET)

      const totpRes = await frisby.post(`${REST_URL}/2fa/verify`, {
        tmpToken: loginRes.json.data.tmpToken,
        totpToken
      })

      return totpRes.json.authentication
    }

    return loginRes.json.authentication
  } catch (err) {
    throw new Error('Login failed securely')
  }
}

function getStatus (token) {
  return frisby.get(`${REST_URL}/2fa/status`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    }
  })
}
