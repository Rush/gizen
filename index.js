#!/usr/bin/env node
const Promise = require('bluebird');
const GitHubApi = require("github");

const readline = require('readline');
const {readFileSync, existsSync} = require('fs');
const {join: pathJoin } = require('path');

let rl;

createRl = () => {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
};

createRl();

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
const foldersToSearch = ['./', process.env.HOME];

try {
  foldersToSearch.every((folder) => {
    const fileName = pathJoin(folder, '.gizen');
    if (existsSync(fileName)) {
      config = JSON.parse(readFileSync(fileName));
    }
    return !config;
  });
  if(!config) {
    throw new Error("Could not find the .gizen file!");
  }
} catch(err) {
  console.error(err.message);
  console.error('');
  console.error('Please create valid JSON file at ~/.gizen or ./.gizen containing');
  console.error(JSON.stringify({
    githubToken: '<GITHUB_TOKEN>',
    zenhubToken: '<ZENHUB_TOKEN>',
    defaultLabels: [],
    owner: '<GITHUB_USER_OR_ORG>', repo: '<GITHUB_REPO_NAME>',
    defaultState: 'closed',
    defaultAssignees: [],
    assigneeAliases: {
      'alias': 'user'
    }
  }, null, 2));
  process.exit(1);
}

github.authenticate({
  type: "token",
  token: config.githubToken,
});

const api = new ZenHub(config.zenhubToken);

const {owner, repo, defaultAssignees, assigneeAliases, defaultState} = config;
  
const simpleQuestion = prompt => new Promise(resolve => rl.question(prompt, resolve));
  
const question = (prompt, opts = {}) => { 
  return simpleQuestion(`${prompt}${opts.default ? ` (${opts.default})` : ''}: `).then(answer => {
    if(answer.length === 0) {
      return opts.default || question(prompt, opts);
    }
    return answer;
  });
};

const multiline = prompt => new Promise(resolve => {
  const input = [];
  console.log(prompt);
  rl.prompt(true);
  lineHandler = cmd => {
    input.push(cmd);
    rl.prompt();
  };
  rl.on('line', lineHandler);
  rl.once('close', cmd => {
    resolve(input.join('\n'));
    createRl();
  });
});

const repoIdPromise = github.repos.get({
  owner, repo
}).get('data').get('id');

function mapAliases(rawAssignees) {
  return rawAssignees.map(assignee => {
    return (assigneeAliases || {})[assignee] || assignee;
  });
}
  
  
return Promise.mapSeries([
  () => process.argv[2] || question(`Points`, {default: 1}),
  () => process.argv[3] || question('Issue title'),
  () => process.argv[4] || multiline('Issue text (press Ctrl+D to finish typing)'),
  () => process.argv[5] || question(`Assignees`, {default: defaultAssignees && defaultAssignees.length && mapAliases(defaultAssignees).join(' ') }),
  () => process.argv[6] || question(`State`, {default: defaultState || 'open'}),
  () => repoIdPromise
], f => f()).spread((points, issueTitle, issueText, assigneesText, state, repoId) => {    
  const rawAssignees = assigneesText && assigneesText.split(/(?:\s+|,)/) || defaultAssignees;
  const assignees = mapAliases(rawAssignees);
  
  points = points || 1;
  state = state || defaultState || 'open';

  if(process.env.DEBUG_ISSUE_CREATE) {
    console.log({
      state,
      owner, repo,
      title: issueTitle,
      body: issueText,
      assignees,
      labels: config.defaultLabels,
      points
    });
    process.exit(1);
  }

  return github.issues.create({
    owner, repo,
    title: issueTitle,
    body: issueText,
    assignees,
    labels: config.defaultLabels
  }).then(status => {
    const issueNumber = status.data.number;
    
    return Promise.all([
      api.setEstimate({
        repo_id: repoId,
        issue_number: issueNumber,
        body: {
          estimate: parseInt(points)
        }
      }),
      github.issues.edit({
        owner, repo,
        number: issueNumber,
        state
      })
    ]).then(() => issueNumber);
  });
}).then(issueNumber => {
  console.log(`https://github.com/${config.owner}/${config.repo}/issues/${issueNumber}`);
  process.exit(0);
});
