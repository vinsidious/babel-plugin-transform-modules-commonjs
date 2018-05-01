declare module '@babel/core' {
	export function transformSync(code, opts: any): { code: string; ast: any };
}
