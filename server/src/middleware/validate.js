function validateBody(requiredFields) {
  return (req, res, next) => {
    const missing = [];
    for (const field of requiredFields) {
      if (req.body[field] === undefined || req.body[field] === null || req.body[field] === '') {
        missing.push(field);
      }
    }
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }
    next();
  };
}

function validateUUID(paramName) {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return (req, res, next) => {
    const val = req.params[paramName] || req.query[paramName];
    if (val && !UUID_REGEX.test(val)) {
      return res.status(400).json({ error: `Invalid ${paramName}: must be a valid UUID` });
    }
    next();
  };
}

function validateEnum(field, allowedValues) {
  return (req, res, next) => {
    const val = req.body[field];
    if (val !== undefined && val !== null && !allowedValues.includes(val)) {
      return res.status(400).json({ error: `Invalid ${field}: must be one of ${allowedValues.join(', ')}` });
    }
    next();
  };
}

module.exports = { validateBody, validateUUID, validateEnum };
