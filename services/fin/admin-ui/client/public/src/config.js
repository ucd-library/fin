const config = APP_CONFIG || {};

config.env.REPO_URL = 'https://github.com/ucd-library/fin';
config.repoUrl = config.env.REPO_URL;
config.baseVersionUrl = config.repoUrl + '/tree/'+ (config.env.FIN_REPO_TAG || config.env.FIN_BRANCH_NAME);
config.baseDocsUrl = config.baseVersionUrl + '/docs';

export default config