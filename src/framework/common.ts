
// new (...args: any[]): any is actually how TS defines type of a class
export type Constructor<T = any> = { new (...args: any[]): T; name: string };
