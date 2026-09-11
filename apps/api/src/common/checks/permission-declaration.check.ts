import { Injectable, Logger, RequestMethod, type OnApplicationBootstrap } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { GRANTABLE_PERMISSION_KEYS, type GrantablePermissionKey } from '@pallet/shared';
import { getAccessRules, type AccessRule } from '../decorators/access.decorators';

export interface RouteDeclaration {
  /** `GET /api/items/:id` — the label used in the startup table and in failure messages. */
  route: string;
  rule: AccessRule;
}

function joinPath(...segments: unknown[]): string {
  const parts = segments
    .map((segment) => (typeof segment === 'string' ? segment : ''))
    .flatMap((segment) => segment.split('/'))
    .filter((segment) => segment !== '');
  return `/${parts.join('/')}`;
}

function describeRule(rule: AccessRule): string {
  switch (rule.kind) {
    case 'public':
      return 'public';
    case 'authenticated':
      return 'authenticated';
    case 'adminOnly':
      return 'admin only';
    case 'all':
      return `all of ${rule.keys.join(', ')}`;
    case 'any':
      return `any of ${rule.keys.join(', ')}`;
  }
}

function ruleKeys(rule: AccessRule): GrantablePermissionKey[] {
  return rule.kind === 'all' || rule.kind === 'any' ? rule.keys : [];
}

/**
 * Fails startup when a route handler does not declare its access exactly once, or declares a
 * permission key that is not grantable (§6.4.2). A route that reaches production undeclared
 * would be reachable by any authenticated user, so this is a hard failure, not a warning.
 */
@Injectable()
export class PermissionDeclarationCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionDeclarationCheck.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
  ) {}

  onApplicationBootstrap(): void {
    const declarations = this.scan();
    this.logger.debug(
      `Route access declarations:\n${declarations.map((d) => `  ${d.route} → ${describeRule(d.rule)}`).join('\n')}`,
    );
  }

  /** Every declared route, in discovery order. Throws when any handler is misdeclared. */
  scan(): RouteDeclaration[] {
    const declarations: RouteDeclaration[] = [];
    const undeclared: string[] = [];
    const duplicated: string[] = [];
    const unknownKeys: string[] = [];
    const emptyKeys: string[] = [];

    for (const wrapper of this.discovery.getControllers()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) continue;
      const prototype = Object.getPrototypeOf(instance) as object;
      const controllerPath = Reflect.getMetadata(PATH_METADATA, metatype) as unknown;

      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const handler = (instance as Record<string, unknown>)[methodName];
        if (typeof handler !== 'function') continue;
        const handlerPath = Reflect.getMetadata(PATH_METADATA, handler) as unknown;
        if (handlerPath === undefined) continue;

        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
        const route = `${RequestMethod[method] ?? 'ALL'} ${joinPath('api', controllerPath, handlerPath)}`;
        const [rule, ...extraRules] = getAccessRules(handler);

        if (rule === undefined) {
          undeclared.push(route);
          continue;
        }
        if (extraRules.length > 0) {
          duplicated.push(route);
          continue;
        }

        // A permission rule with no keys passes every check while reading like a gate.
        if ((rule.kind === 'all' || rule.kind === 'any') && rule.keys.length === 0) {
          emptyKeys.push(route);
          continue;
        }
        for (const key of ruleKeys(rule)) {
          if (!GRANTABLE_PERMISSION_KEYS.includes(key)) unknownKeys.push(`${route} (${key})`);
        }
        declarations.push({ route, rule });
      }
    }

    const problems = [
      undeclared.length > 0 ? `Routes without access declaration: ${undeclared.join(', ')}` : '',
      duplicated.length > 0 ? `Routes with more than one access declaration: ${duplicated.join(', ')}` : '',
      emptyKeys.length > 0 ? `Routes declaring a permission rule without keys: ${emptyKeys.join(', ')}` : '',
      unknownKeys.length > 0 ? `Routes declaring a non-grantable permission key: ${unknownKeys.join(', ')}` : '',
    ].filter((problem) => problem !== '');
    if (problems.length > 0) throw new Error(problems.join('; '));

    return declarations;
  }

  /** Grantable keys named by at least one route — the coverage assertion of §6.4.2. */
  declaredKeys(): Set<GrantablePermissionKey> {
    return new Set(this.scan().flatMap((declaration) => ruleKeys(declaration.rule)));
  }
}
