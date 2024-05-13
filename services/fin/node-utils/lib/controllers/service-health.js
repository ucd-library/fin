

function ready(config={}) {
  return (req, res) => {
    res.send('ok');
  }
}

function alive(config={}) {
  return (req, res) => {
    res.send('ok');
  }
}

function register(app, config={}) {
  app.get('/health/ready', ready(config));
  app.get('/health/alive', alive(config));
}

module.exports = {
  ready,
  alive,
  register
}