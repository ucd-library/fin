const {Command} = require('commander');
const config = require('../lib/cli/ConfigCli');
const program = new Command();

program.command('login')
  .description('Login using UCD CAS Authentication')
  .option('-l, --local <username>', 'Login using local UCD DAMS authentication')
  .option('-h, --headless', 'Login without local browser, copy and paste token')
  .option('-s, --super-user <username>', 'Login as a user with admin privileges using root server credentials')
  .option('-S, --service-name <serviceName>', 'Fin auth service name (default: keycloak-oidc)')
  .action(options => {
    config.login(options);
  });

program.command('logout')
  .description('Logout current user')
  .action(() => {
    config.logout();
  });

program.parse(process.argv);