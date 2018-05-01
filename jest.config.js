module.exports = {
	globals: {
		'ts-jest': {
			tsConfigFile: 'tsconfig.json'
		}
	},
	moduleFileExtensions: [
		'ts',
		'js'
	],
	transform: {
		'^.+\\.(ts|tsx)$': './node_modules/ts-jest/preprocessor.js'
	},
	testMatch: [
		'**/__tests__/**/*.spec.(ts|js)'
	],
	testEnvironment: 'node',
	coverageThreshold: {
		global: {
		  branches: 40,
		  functions: 40,
		  lines: 40,
		  statements: 40
		}
	},
	coverageDirectory: "./coverage/",
	collectCoverage: true
}
