#!/usr/bin/env node
const Promise = require('bluebird');
const GitHubApi = require("github");

const readline = require('readline');
const {readFileSync} = require('fs');
const {join: pathJoin } = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

Promise.longStackTraces();

var github = new GitHubApi({
  headers: {
    "user-agent": "gizen" 
  },
  Promise: require('bluebird'),
  followRedirects: false, 
  timeout: 5000
});
  
const ZenHub = require('zenhub-api');
  
let config;
try {
  config = JSON.parse(readFileSync(pathJoin(process.env.HOME, '.gizen')));
} catch(err) {  
  console.error(err.message);
  console.error('');
  console.error('Please create valid JSON file at ~/.gizen containing');
  console.error(JSON.stringify({
    githubToken: '<GITHUB_TOKEN>',
    zenhubToken: '<ZENHUB_TOKEN>',
    defaultLabels: [],
    owner: '<GITHUB_USER_OR_ORG>', repo: '<GITHUB_REPO_NAME>',
    defaultState: 'closed',
    defaultAssignees: []
  }, null, 2));
  process.exit(1);
}

github.authenticate({
  type: "token",
  token: config.githubToken,
});

const api = new ZenHub(config.zenhubToken);

const {owner, repo} = config;
  
const question = prompt => new Promise(resolve => rl.question(prompt, resolve));

  
github.repos.get({
  owner, repo
}).then(status => {
  const repoId = status.data.id;
  
  return Promise.mapSeries([
    () => process.argv[2] || question('Points: '),
    () => process.argv[3] || question('Issue title: '),
    () => process.argv[4] || question('Issue text: '),
  ], f => f()).spread((points, issueTitle, issueText) => {
    return github.issues.create({
      owner, repo,
      title: issueTitle,
      body: issueText,
      assignees: config.defaultAssignees,
      labels: config.defaultLabels
    }).then(status => {
      const issueNumber = status.data.number;
      
      return api.setEstimate({
        repo_id: repoId,
        issue_number: issueNumber,
        body: {
          estimate: parseInt(points)
        }
      }).then(() => {
        return github.issues.edit({
          owner, repo,
          number: issueNumber,
          state: config.defaultState || 'open'
        })
      }).then(() => issueNumber);
    });
    
  });
}).then(issueNumber => {
  console.log(`https://github.com/${config.owner}/${config.repo}/issues/${issueNumber}`);
  process.exit(0);
});
