// Bollinger band utilities.
export function upper(mean: number, sd: number, k: number): number { return mean + k * sd; }
export function lower(mean: number, sd: number, k: number): number { return mean - k * sd; }
