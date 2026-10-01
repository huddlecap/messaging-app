const MAX_CONTENT_LENGTH = 2000;
const MAX_CLIENT_MESSAGE_ID_LENGTH = 100;

const isPositiveInt = (v) => Number.isInteger(v) && v > 0;
const isDigits = (v) => typeof v === "string" && /^\d+$/.test(v);

function validateRegister(body) {
  const { username, password } = body || {};

  if (typeof username !== "string" || typeof password !== "string") {
    return { ok: false, error: "Username and password are required" };
  }

  const cleanUsername = username.trim();

  if (cleanUsername.length < 3 || cleanUsername.length > 50) {
    return { ok: false, error: "Username must be 3-50 characters" };
  }
  if (password.length < 8 || Buffer.byteLength(password) > 72) {
    return { ok: false, error: "Password must be 8-72 characters" };
  }

  return { ok: true, value: { username: cleanUsername, password } };
}

function validateLogin(body) {
  const { username, password } = body || {};

  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    !username ||
    !password
  ) {
    return { ok: false, error: "Username and password are required" };
  }

  return { ok: true, value: { username, password } };
}

function validateHistoryQuery(params, query) {
  const { otherUserId } = params || {};
  const { before, limit } = query || {};

  if (!isDigits(otherUserId) || Number(otherUserId) < 1) {
    return { ok: false, error: "Invalid otherUserId" };
  }

  let beforeValue = null;
  if (before !== undefined) {
    if (!isDigits(before) || Number(before) < 1) {
      return { ok: false, error: "before must be a positive integer" };
    }
    beforeValue = Number(before);
  }

  let limitValue = 50;
  if (limit !== undefined) {
    if (!isDigits(limit) || Number(limit) < 1 || Number(limit) > 100) {
      return { ok: false, error: "limit must be an integer from 1 to 100" };
    }
    limitValue = Number(limit);
  }

  return {
    ok: true,
    value: {
      otherUserId: Number(otherUserId),
      before: beforeValue,
      limit: limitValue,
    },
  };
}

function validateMessagePayload(parsed) {
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "Invalid message format" };
  }

  const { receiver_id, content, client_message_id } = parsed;

  if (!isPositiveInt(receiver_id)) {
    return { ok: false, error: "receiver_id must be a positive integer" };
  }
  if (
    typeof content !== "string" ||
    content.trim().length === 0 ||
    content.length > MAX_CONTENT_LENGTH
  ) {
    return {
      ok: false,
      error: `content must be a non-empty string up to ${MAX_CONTENT_LENGTH} characters`,
    };
  }
  if (
    typeof client_message_id !== "string" ||
    client_message_id.length === 0 ||
    client_message_id.length > MAX_CLIENT_MESSAGE_ID_LENGTH
  ) {
    return {
      ok: false,
      error: `client_message_id must be a string up to ${MAX_CLIENT_MESSAGE_ID_LENGTH} characters`,
    };
  }

  return { ok: true, value: { receiver_id, content, client_message_id } };
}

function validateReadReceipt(parsed) {
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "Invalid message format" };
  }
  if (!isPositiveInt(parsed.message_id)) {
    return { ok: false, error: "message_id must be a positive integer" };
  }
  return { ok: true, value: { message_id: parsed.message_id } };
}

module.exports = {
  validateRegister,
  validateLogin,
  validateHistoryQuery,
  validateMessagePayload,
  validateReadReceipt,
};
