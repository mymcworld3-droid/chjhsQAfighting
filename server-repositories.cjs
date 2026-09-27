'use strict';

const { adminProject } = require('./firebase-admin-projects.cjs');

const DOMAIN_PROJECT_ROLES = Object.freeze({
  player: 'A',
  economy: 'A',
  market: 'A',
  settlement: 'A',
  dongtian: 'BD',
  battle: 'C',
  raid: 'C'
});

function createRepository(domain) {
  const role = DOMAIN_PROJECT_ROLES[domain];
  if (!role) throw new Error('Unknown repository domain: ' + domain);
  return Object.freeze({
    domain,
    role,
    resolve(options) {
      return adminProject(role, options);
    }
  });
}

const playerRepository = createRepository('player');
const dongtianRepository = createRepository('dongtian');
const battleRepository = createRepository('battle');
const raidRepository = createRepository('raid');

module.exports = {
  DOMAIN_PROJECT_ROLES,
  createRepository,
  playerRepository,
  dongtianRepository,
  battleRepository,
  raidRepository
};
