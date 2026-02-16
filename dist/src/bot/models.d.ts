import type { ZarukaConfig } from '../core/types.js';
export interface ModelOption {
    id: string;
    label: string;
}
export interface ModelListResult {
    popular: ModelOption[];
    all: ModelOption[];
}
export declare function clearModelsCache(): void;
export declare function fetchAvailableModels(ai: NonNullable<ZarukaConfig['ai']>): Promise<ModelListResult>;
//# sourceMappingURL=models.d.ts.map