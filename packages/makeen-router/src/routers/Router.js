/* eslint-disable no-restricted-syntax */
import Joi from 'joi';
import Boom from 'boom';
import trimEnd from 'lodash/trimEnd';
import trimStart from 'lodash/trimStart';
import get from 'lodash/get';

class Router {
  static mergeRouteConfig(...configs) {
    return configs.reduce(
      (acc, config) => ({
        ...acc,
        ...config,
        validate: ['query', 'params', 'payload'].reduce(
          (validateAcc, type) => {
            const validator = {
              ...get(acc, `validate.${type}`, {}),
              ...get(config, `validate.${type}`, {}),
            };

            if (Object.keys(validator).length) {
              Object.assign(validateAcc, {
                [type]: validator,
              });
            }

            return validateAcc;
          },
          {},
        ),
        pre: [...get(acc, 'pre', []), ...get(config, 'pre', [])],
      }),
      {},
    );
  }

  constructor(config) {
    this.setConfig(config);
    this.routes = {};
    this.loadRoutes();
  }

  loadRoutes() {
    for (const propr in this) {
      if (typeof this[propr] === 'function' && this[propr].isRoute) {
        const { definition } = this[propr];
        const routeId = definition.id || propr;
        this.addRoute(routeId, {
          ...definition,
          handler: this[propr].bind(this),
        });
      }
    }
  }

  setConfig(config = {}) {
    this.config = Joi.attempt(
      config,
      Joi.object()
        .keys({
          namespace: Joi.string().required(),
          basePath: Joi.string().default(''),
          baseRouteConfig: Joi.object().default({}),
        })
        .unknown(),
    );
  }

  addRoute(id, routeConfig) {
    const routes = this.getRoutes();

    if (!id) {
      throw new Error('Route id is required!');
    }

    if (routes[id]) {
      throw new Error(`Route with id "${id}" already added!`);
    }

    const route = {
      method: 'GET',
      ...routeConfig,
    };

    this.routes[id] = {
      ...route,
      path: this.buildPath(route.path),
      handler: typeof route.handler === 'function'
        ? Router.wrapHandler(route.handler)
        : route.handler,
      config: this.constructor.mergeRouteConfig(
        this.config.baseRouteConfig,
        {
          id: `${this.config.namespace}:${id}`,
          tags: ['api'],
        },
        route.config,
      ),
    };

    return this;
  }

  buildPath(suffix) {
    return trimEnd(
      `${trimEnd(this.config.basePath, '/')}/${trimStart(suffix, '/')}`,
      '/',
    );
  }

  addRoutes(routes) {
    Object.keys(routes).forEach(routeId => {
      this.addRoute(routeId, routes[routeId]);
    });

    return this;
  }

  getRoutes() {
    return this.routes;
  }

  toArray(args) {
    const routes = this.getRoutes();
    const { only, without } = {
      only: [],
      without: [],
      ...(args || {}),
    };

    let ids = Object.keys(routes);

    if (only.length) {
      ids = ids.filter(id => only.includes(id));
    }

    if (without.length) {
      ids = ids.filter(id => !without.includes(id));
    }

    return ids.reduce((acc, id) => [...acc, routes[id]], []);
  }

  static wrapHandler(handler) {
    // eslint-disable-next-line func-names
    return async function (request, reply) {
      try {
        const response = await Promise.resolve(
          handler.call(this, request, reply),
        );
        if (typeof response !== 'undefined') {
          reply(response);
        }
      } catch (err) {
        reply(Boom.wrap(err));
      }
    };
  }

  mount(server) {
    server.route(this.toArray());
  }
}

export default Router;
