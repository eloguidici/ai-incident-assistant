import { DynamicModule, Inject, Module, type Provider } from '@nestjs/common';
import { ConfigRegistry, loadConfig, type ConfigSlice, type ConfigSource } from '../../core';
import { loadEnvFiles, type EnvFileLoaderOptions } from '../../dotenv';
import { CONFIG_REGISTRY_TOKEN, getConfigToken } from './config-tokens';

export interface ReusableConfigModuleOptions {
  slices: readonly ConfigSlice<unknown>[];
  source?: ConfigSource;
  envFiles?: EnvFileLoaderOptions;
  global?: boolean;
  allowUnknown?: boolean;
  abortEarly?: boolean;
}

@Module({})
export class ReusableConfigModule {
  /**
   * Loads env files, validates every slice, and exports one provider per slice.
   * @param options Slices owned by this application. The module does not define their variables.
   */
  static register(options: ReusableConfigModuleOptions): DynamicModule {
    if (options.envFiles) {
      loadEnvFiles(options.envFiles);
    }

    const registry = loadConfig({
      source: options.source,
      slices: options.slices,
      allowUnknown: options.allowUnknown,
      abortEarly: options.abortEarly,
    });

    const sliceProviders: Provider[] = options.slices.map((slice) => ({
      provide: getConfigToken(slice),
      useValue: registry.get(slice),
    }));

    return {
      module: ReusableConfigModule,
      global: options.global ?? true,
      providers: [
        {
          provide: CONFIG_REGISTRY_TOKEN,
          useValue: registry,
        },
        ...sliceProviders,
      ],
      exports: [CONFIG_REGISTRY_TOKEN, ...options.slices.map(getConfigToken)],
    };
  }
}

/** Injects the mapped settings of one slice. */
export function InjectConfig<T>(slice: ConfigSlice<T>): ParameterDecorator {
  return Inject(getConfigToken(slice));
}

/** Injects the registry when a class needs more than one slice by name. */
export function InjectConfigRegistry(): ParameterDecorator {
  return Inject(CONFIG_REGISTRY_TOKEN);
}

export type { ConfigRegistry };
