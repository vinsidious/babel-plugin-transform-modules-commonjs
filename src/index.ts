import { basename, extname } from 'path';

import * as Traverse from '@babel/traverse';
import * as types from '@babel/types';

import * as templates from './templates';

export default function() {
	let REASSIGN_REMAP_SKIP = Symbol();

	let reassignmentVisitor = {
		ReferencedIdentifier(path) {
			let name = path.node.name;
			let remap = this.remaps[name];
			if (!remap) return;

			// redeclared in this scope
			if (this.scope.getBinding(name) !== path.scope.getBinding(name)) return;

			if (
				path.parentPath.isCallExpression({
					callee: path.node,
				})
			) {
				path.replaceWith(types.sequenceExpression([types.numericLiteral(0), remap]));
			} else {
				path.replaceWith(remap);
			}
			this.requeueInParent(path);
		},

		AssignmentExpression(path) {
			let node = path.node;
			if (node[REASSIGN_REMAP_SKIP]) return;

			let left = path.get('left');
			if (!left.isIdentifier()) return;

			let name = left.node.name;
			let exports = this.exports[name];
			if (!exports) return;

			// redeclared in this scope
			if (this.scope.getBinding(name) !== path.scope.getBinding(name)) return;

			node[REASSIGN_REMAP_SKIP] = true;

			for (let reid of exports) {
				node = templates.buildExportsAssignment({ IDENTIFIER: reid, VALUE: node }).expression;
			}

			path.replaceWith(node);
			this.requeueInParent(path);
		},

		UpdateExpression(path) {
			let arg = path.get('argument');
			if (!arg.isIdentifier()) return;

			let name = arg.node.name;
			let exports = this.exports[name];
			if (!exports) return;

			// redeclared in this scope
			if (this.scope.getBinding(name) !== path.scope.getBinding(name)) return;

			let node = types.assignmentExpression(
				path.node.operator[0] + '=',
				arg.node,
				types.numericLiteral(1),
			);

			if ((path.parentPath.isExpressionStatement() && !path.isCompletionRecord()) || path.node.prefix) {
				path.replaceWith(node);
				this.requeueInParent(path);
				return;
			}

			let nodes = [];
			nodes.push(node);

			let operator;
			if (path.node.operator === '--') {
				operator = '+';
			} else {
				// "++"
				operator = '-';
			}
			nodes.push(types.binaryExpression(operator, arg.node, types.numericLiteral(1)));

			let newPaths = path.replaceWithMultiple(types.sequenceExpression(nodes));
			for (const newPath of newPaths) this.requeueInParent(newPath);
		},
	};

	return {
		visitor: <Traverse.Visitor>{
			Program: {
				exit(path) {
					const strict = !!this.opts.strict;

					const { scope } = path;

					// rename these commonjs variables if they're declared in the file
					scope.rename('module');
					scope.rename('exports');
					scope.rename('require');

					let hasExports = false;
					let hasDefaultExport = false;
					let hasNamedExport = false;
					let hasImports = false;

					let body = path.get('body');
					let imports = Object.create(null);
					let exports = Object.create(null);

					let nonHoistedExportNames = Object.create(null);

					let topNodes = [];
					let remaps = Object.create(null);

					let requires = Object.create(null);

					function getIdentifier(name) {
						return {
							name: name,
							type: 'Identifier',
						};
					}

					function checkExportType(exportName) {
						if (exportName === 'default') {
							hasDefaultExport = true;
						} else {
							hasNamedExport = true;
						}
					}

					function addRequire(source, blockHoist) {
						let cached = requires[source];
						if (cached) return cached;

						let ref = path.scope.generateUidIdentifier(basename(source, extname(source)));

						let varDecl = types.variableDeclaration('var', [
							types.variableDeclarator(
								ref,
								templates.buildRequire({ MODULE: types.stringLiteral(source) }).expression,
							),
						]);

						// Copy location from the original import statement for sourcemap
						// generation.
						if (imports[source]) {
							varDecl.loc = imports[source].loc;
						}

						if (typeof blockHoist === 'number' && blockHoist > 0) {
							(varDecl as any)._blockHoist = blockHoist;
						}

						topNodes.push(varDecl);

						return (requires[source] = ref);
					}

					function addTo(obj, key, arr) {
						let existing = obj[key] || [];
						obj[key] = existing.concat(arr);
					}

					for (let path of body as any) {
						if (path.isExportDeclaration()) {
							hasExports = true;

							let specifiers = [].concat(path.get('declaration'), path.get('specifiers'));
							for (let specifier of specifiers) {
								let ids = specifier.getBindingIdentifiers();
								if (ids.__esModule) {
									throw specifier.buildCodeFrameError('Illegal export "__esModule"');
								}
							}
						}

						if (path.isImportDeclaration()) {
							hasImports = true;

							let key = path.node.source.value;
							let importsEntry = imports[key] || {
								specifiers: [],
								maxBlockHoist: 0,
								loc: path.node.loc,
							};

							importsEntry.specifiers.push(...path.node.specifiers);

							if (typeof path.node._blockHoist === 'number') {
								importsEntry.maxBlockHoist = Math.max(
									path.node._blockHoist,
									importsEntry.maxBlockHoist,
								);
							}

							imports[key] = importsEntry;

							path.remove();
						} else if (path.isExportDefaultDeclaration()) {
							hasDefaultExport = true;
							let declaration = path.get('declaration');
							if (declaration.isFunctionDeclaration()) {
								let id = declaration.node.id;
								let defNode = types.identifier('default');
								if (id) {
									addTo(exports, id.name, defNode);
									topNodes.push(
										templates.buildExportsAssignment({ IDENTIFIER: defNode, VALUE: id }),
									);
									path.replaceWith(declaration.node);
								} else {
									topNodes.push(
										templates.buildExportsAssignment({
											IDENTIFIER: defNode,
											VALUE: (types as any).toExpression(declaration.node),
										}),
									);
									path.remove();
								}
							} else if (declaration.isClassDeclaration()) {
								let id = declaration.node.id;
								let defNode = types.identifier('default');
								if (id) {
									addTo(exports, id.name, defNode);
									path.replaceWithMultiple([
										declaration.node,
										templates.buildExportsAssignment(defNode, id),
									]);
								} else {
									path.replaceWith(
										templates.buildExportsAssignment({
											IDENTIFIER: defNode,
											VALUE: (types as any).toExpression(declaration.node),
										}),
									);
								}
							} else {
								path.replaceWith(
									templates.buildExportsAssignment({
										IDENTIFIER: types.identifier('default'),
										VALUE: declaration.node,
									}),
								);

								// Manualy re-queue `export default foo;` expressions so that the ES3 transform
								// has an opportunity to convert them. Ideally this would happen automatically from the
								// replaceWith above. See T7166 for more info.
								path.parentPath.requeue(path.get('expression.left'));
							}
						} else if (path.isExportNamedDeclaration()) {
							let declaration = path.get('declaration');
							if (declaration.node) {
								if (declaration.isFunctionDeclaration()) {
									let id = declaration.node.id;
									checkExportType(id.name);
									addTo(exports, id.name, id);
									topNodes.push(
										templates.buildExportsAssignment({ IDENTIFIER: id, VALUE: id }),
									);
									path.replaceWith(declaration.node);
								} else if (declaration.isClassDeclaration()) {
									let id = declaration.node.id;
									checkExportType(id.name);
									addTo(exports, id.name, id);
									path.replaceWithMultiple([
										declaration.node,
										templates.buildExportsAssignment({ IDENTIFIER: id, VALUE: id }),
									]);
									nonHoistedExportNames[id.name] = true;
								} else if (declaration.isVariableDeclaration()) {
									let declarators = declaration.get('declarations');
									for (let decl of declarators) {
										let id = decl.get('id');

										let init = decl.get('init');
										if (!init.node) init.replaceWith(types.identifier('undefined'));

										hasNamedExport = true;

										if (id.isIdentifier()) {
											addTo(exports, id.node.name, id.node);
											init.replaceWith(
												templates.buildExportsAssignment({
													IDENTIFIER: id.node,
													VALUE: init.node,
												}).expression,
											);
											nonHoistedExportNames[id.node.name] = true;
										}
									}
									path.replaceWith(declaration.node);
								}
								continue;
							}

							let specifiers = path.get('specifiers');
							if (specifiers.length) {
								let nodes = [];
								let source = path.node.source;
								if (source) {
									let ref = addRequire(source.value, path.node._blockHoist);

									for (let specifier of specifiers) {
										if (specifier.isExportSpecifier()) {
											checkExportType(specifier.node.exported.name);

											if (specifier.node.local.name === 'default') {
												topNodes.push(
													templates.buildExportsFrom({
														PROPERTY: types.stringLiteral(
															specifier.node.exported.name,
														),
														VALUE: types.memberExpression(
															types.callExpression(
																this.addHelper('interopRequireDefault'),
																[ref],
															),
															specifier.node.local,
														),
													}),
												);
											} else {
												topNodes.push(
													templates.buildExportsFrom({
														PROPERTY: types.stringLiteral(
															specifier.node.exported.name,
														),
														VALUE: types.memberExpression(
															ref,
															specifier.node.local,
														),
													}),
												);
											}
											nonHoistedExportNames[specifier.node.exported.name] = true;
										}
									}
								} else {
									for (let specifier of specifiers) {
										if (specifier.isExportSpecifier()) {
											checkExportType(specifier.node.exported.name);
											addTo(
												exports,
												specifier.node.local.name,
												specifier.node.exported,
											);
											nonHoistedExportNames[specifier.node.exported.name] = true;
											nodes.push(
												templates.buildExportsAssignment({
													IDENTIFIER: specifier.node.exported,
													VALUE: specifier.node.local,
												}),
											);
										}
									}
								}
								path.replaceWithMultiple(nodes);
							}
						} else if (path.isExportAllDeclaration()) {
							hasNamedExport = true;
							let exportNode = templates.buildExportAll({
								OBJECT: addRequire(path.node.source.value, path.node._blockHoist),
							});
							exportNode.loc = path.node.loc;
							topNodes.push(exportNode);
							path.remove();
						}
					}

					for (let source in imports) {
						let { specifiers, maxBlockHoist } = imports[source];
						if (specifiers.length) {
							let uid = addRequire(source, maxBlockHoist);

							for (let i = 0; i < specifiers.length; i++) {
								let specifier = specifiers[i];
								if (types.isImportNamespaceSpecifier(specifier)) {
									if (strict) {
										remaps[specifier.local.name] = uid;
									} else {
										const varDecl = types.variableDeclaration('var', [
											types.variableDeclarator(
												specifier.local,
												types.callExpression(
													this.addHelper('interopRequireWildcard'),
													[uid],
												),
											),
										]);

										if (maxBlockHoist > 0) {
											(varDecl as any)._blockHoist = maxBlockHoist;
										}

										topNodes.push(varDecl);
									}
								} else if (types.isImportDefaultSpecifier(specifier)) {
									specifiers[i] = types.importSpecifier(
										specifier.local,
										types.identifier('default'),
									);
								}
							}

							for (let specifier of specifiers) {
								if (types.isImportSpecifier(specifier)) {
									let target = uid;
									if (specifier.imported.name === 'default') {
										target = specifier.local;

										const requireDefault = this.addHelper('interopRequireDefault');
										const callExpression = types.callExpression(requireDefault, [uid]);
										const declaration = types.memberExpression(
											callExpression,
											getIdentifier('default'),
										);
										const varDecl = types.variableDeclaration('var', [
											types.variableDeclarator(target, declaration),
										]);

										if (maxBlockHoist > 0) {
											(varDecl as any)._blockHoist = maxBlockHoist;
										}

										topNodes.push(varDecl);
									} else {
										// is a named import
										target = specifier.local;

										const varDecl = types.variableDeclaration('var', [
											types.variableDeclarator(
												target,
												types.memberExpression(uid, specifier.imported),
											),
										]);

										if (maxBlockHoist > 0) {
											(varDecl as any)._blockHoist = maxBlockHoist;
										}

										topNodes.push(varDecl);
									}

									if (specifier.local.name !== target.name) {
										remaps[specifier.local.name] = types.memberExpression(
											target,
											(types as any).cloneWithoutLoc(specifier.imported),
										);
									}
								}
							}
						} else {
							const requireNode = templates.buildRequire({
								MODULE: types.stringLiteral(source),
							});
							requireNode.loc = imports[source].loc;
							topNodes.push(requireNode);
						}
					}

					if (hasImports && Object.keys(nonHoistedExportNames).length) {
						let hoistedExportsNode = types.identifier('undefined');

						for (let name in nonHoistedExportNames) {
							hoistedExportsNode = templates.buildExportsAssignment({
								IDENTIFIER: types.identifier(name),
								VALUE: hoistedExportsNode,
							}).expression;
						}

						const node = types.expressionStatement(hoistedExportsNode);
						(node as any)._blockHoist = 3;

						topNodes.unshift(node);
					}

					// add __esModule declaration if this file has any exports
					if (hasExports && !strict) {
						let buildTemplate = templates.buildExportsModuleDeclaration;
						if (this.opts.loose) buildTemplate = templates.buildLooseExportsModuleDeclaration;

						const declar = buildTemplate();
						declar._blockHoist = 3;

						topNodes.unshift(declar);
					}

					(path as any).unshiftContainer('body', topNodes);

					if (this.opts.addExports && hasDefaultExport && !hasNamedExport) {
						(path as any).pushContainer('body', templates.buildDefaultExport());
					}

					path.traverse(reassignmentVisitor, {
						remaps,
						scope,
						exports,
						requeueInParent: newPath => (path as any).requeue(newPath),
					});
				},
			},
		},
	};
}
