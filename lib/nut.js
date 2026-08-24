const net = require('net');

// Splits a NUT protocol line into tokens, respecting double-quoted segments
// (values with spaces are quoted, e.g. VAR ups ups.mfr "American Power Conversion").
function tokenize(line) {
  const tokens = [];
  let i = 0;
  while (i < line.length) {
    while (line[i] === ' ') i++;
    if (i >= line.length) break;
    if (line[i] === '"') {
      i++;
      let val = '';
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && i + 1 < line.length) {
          val += line[i + 1];
          i += 2;
        } else {
          val += line[i];
          i++;
        }
      }
      i++; // closing quote
      tokens.push(val);
    } else {
      let val = '';
      while (i < line.length && line[i] !== ' ') {
        val += line[i];
        i++;
      }
      tokens.push(val);
    }
  }
  return tokens;
}

/**
 * Fetches all variables for a single UPS from a NUT (Network UPS Tools) server
 * using the plain-text upsd protocol on the given host/port.
 */
function fetchUpsVars({ host, port, ups, username, password, timeoutMs = 6000 }) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';
    let settled = false;
    const vars = {};

    const fail = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      try { socket.write('LOGOUT\n'); } catch (_) { /* ignore */ }
      socket.end();
      resolve(vars);
    };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => fail(new Error('Connection timed out')));
    socket.on('error', (err) => fail(new Error(err.message)));

    let stage = username ? 'username' : 'list';

    socket.on('connect', () => {
      if (stage === 'username') {
        socket.write(`USERNAME ${username}\n`);
      } else {
        socket.write(`LIST VAR ${ups}\n`);
      }
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        handleLine(line);
      }
    });

    function handleLine(line) {
      if (!line) return;

      if (line.startsWith('ERR ')) {
        fail(new Error(line.slice(4).trim() || 'NUT server returned an error'));
        return;
      }

      if (stage === 'username') {
        if (line === 'OK') {
          stage = 'password';
          socket.write(`PASSWORD ${password || ''}\n`);
        }
        return;
      }

      if (stage === 'password') {
        if (line === 'OK') {
          stage = 'list';
          socket.write(`LIST VAR ${ups}\n`);
        }
        return;
      }

      if (stage === 'list') {
        if (line.startsWith('BEGIN LIST VAR')) return;
        if (line.startsWith('END LIST VAR')) {
          succeed();
          return;
        }
        if (line.startsWith('VAR ')) {
          const tokens = tokenize(line.slice(4));
          // tokens: [upsname, varname, value]
          if (tokens.length >= 3) {
            const [, varname, value] = tokens;
            vars[varname] = value;
          }
        }
      }
    }

    socket.connect(port, host);
  });
}

module.exports = { fetchUpsVars };
