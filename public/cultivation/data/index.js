import { DOMAIN_PROJECT_ROLES } from './project-repository.js';
import { playerRepository } from './player-repository.js';
import { dongtianRepository } from './dongtian-repository.js';
import { battleRepository } from './battle-repository.js';
import { raidRepository } from './raid-repository.js';
import { rewardRepository } from './reward-repository.js';

export const repositories = Object.freeze({
  roles: DOMAIN_PROJECT_ROLES,
  player: playerRepository,
  dongtian: dongtianRepository,
  battle: battleRepository,
  raid: raidRepository,
  reward: rewardRepository
});

if (typeof window !== 'undefined') {
  window.xiuxianRepositories = repositories;
}

export {
  DOMAIN_PROJECT_ROLES,
  playerRepository,
  dongtianRepository,
  battleRepository,
  raidRepository,
  rewardRepository
};
