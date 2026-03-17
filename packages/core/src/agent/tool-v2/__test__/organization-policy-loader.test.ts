import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  loadOrganizationPolicy,
  mergeOrganizationPolicyConfigs,
  OrganizationPolicyConfigError,
} from '../organization-policy-loader';

describe('organization-policy-loader', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads and merges global and project policy files', () => {
    const renxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'renx-org-home-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'renx-org-project-'));
    tempDirs.push(renxHome, projectRoot);

    fs.writeFileSync(
      path.join(renxHome, 'organization-policy.json'),
      JSON.stringify(
        {
          version: 'global-v1',
          defaults: {
            network: {
              mode: 'restricted',
              allowedHosts: ['api.example.com'],
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );
    fs.mkdirSync(path.join(projectRoot, '.renx'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, '.renx', 'organization-policy.json'),
      JSON.stringify(
        {
          version: 'project-v2',
          environments: {
            production: {
              rules: [
                {
                  id: 'prod-deny',
                  effect: 'deny',
                  reason: 'blocked',
                  match: {
                    toolNames: ['deploy_release'],
                  },
                },
              ],
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    const loaded = loadOrganizationPolicy({
      projectRoot,
      env: {
        ...process.env,
        RENX_HOME: renxHome,
      },
    });

    expect(loaded.policyVersion).toBe('project-v2');
    expect(loaded.sources.global).toBe(path.join(renxHome, 'organization-policy.json'));
    expect(loaded.sources.project).toBe(
      path.join(projectRoot, '.renx', 'organization-policy.json')
    );
    expect(loaded.policy).toMatchObject({
      version: 'project-v2',
      defaults: {
        network: {
          mode: 'restricted',
          allowedHosts: ['api.example.com'],
        },
      },
      environments: {
        production: {
          rules: [
            {
              id: 'prod-deny',
            },
          ],
        },
      },
    });
  });

  it('merges inline policy overrides on top of loaded policy structures', () => {
    const merged = mergeOrganizationPolicyConfigs(
      {
        version: 'global-v1',
        defaults: {
          network: {
            mode: 'restricted',
            allowedHosts: ['api.example.com'],
          },
        },
      },
      {
        defaults: {
          network: {
            allowedHosts: ['internal.example.com'],
          },
        },
        workspaces: [
          {
            workspaceId: 'workspace-a',
            rules: [
              {
                id: 'workspace-approval',
                effect: 'require_approval',
                reason: 'approval required',
              },
            ],
          },
        ],
      }
    );

    expect(merged).toMatchObject({
      version: 'global-v1',
      defaults: {
        network: {
          allowedHosts: ['api.example.com', 'internal.example.com'],
        },
      },
      workspaces: [
        {
          workspaceId: 'workspace-a',
        },
      ],
    });
  });

  it('throws a clear validation error for invalid policy files', () => {
    const renxHome = fs.mkdtempSync(path.join(os.tmpdir(), 'renx-org-invalid-home-'));
    tempDirs.push(renxHome);

    fs.writeFileSync(
      path.join(renxHome, 'organization-policy.json'),
      JSON.stringify(
        {
          version: 'broken-v1',
          environments: {
            production: {
              rules: [
                {
                  id: 'prod-deny',
                  effect: 'deny',
                  reason: 'blocked',
                  unexpectedField: true,
                },
              ],
            },
          },
        },
        null,
        2
      ),
      'utf8'
    );

    expect(() =>
      loadOrganizationPolicy({
        env: {
          ...process.env,
          RENX_HOME: renxHome,
        },
      })
    ).toThrowError(OrganizationPolicyConfigError);
    expect(() =>
      loadOrganizationPolicy({
        env: {
          ...process.env,
          RENX_HOME: renxHome,
        },
      })
    ).toThrow(/unexpectedField/);
  });
});
