import { RuleTester } from '@typescript-eslint/rule-tester'
import { afterAll, describe, it } from 'bun:test'
import rule from '../../../eslint-rules/no-anonymous-object-types.js'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it

const ruleTester = new RuleTester()

ruleTester.run('no-anonymous-object-types', rule as never, {
  valid: [
    // Named type alias body — allowed.
    `type Point = { x: number; y: number }`,
    // Named interface declaration — allowed.
    `interface Point { x: number; y: number }`,
    // Anonymous object literal nested inside a type alias — allowed.
    `type Either = string | { kind: 'err'; msg: string }`,
    `type Wrapper<T> = { value: T }`,
    `type Nested = { inner: { x: number } }`,
    // Interface member with anonymous return type — allowed (inside interface body).
    `interface Foo { bar(): { x: number } }`,
    // Empty `{}` is idiomatic for "any non-nullish object" — allowed.
    `function f(x: {}): void { void x }`,
    `const x: {} = {}`,
    // Built-in types and references are not literals.
    `function f(): string { return 'a' }`,
    `function f(): Promise<string> { return Promise.resolve('a') }`,
    // Mapped types are not TSTypeLiteral.
    `type Keys<T> = { [K in keyof T]: T[K] }`,
    // Tuple element inside a type alias — defensible to allow since the
    // tuple itself is wrapped by a named type.
    `type T = [{ a: number }]`,
    // Index signature inside a type alias.
    `type Dict = { [k: string]: number }`,
  ],
  invalid: [
    // Function return type — flagged.
    {
      code: `function f(): { x: number } { return { x: 0 } }`,
      errors: [{ messageId: 'anonymous' }],
    },
    // Variable annotation — flagged.
    {
      code: `const p: { x: number; y: number } = { x: 0, y: 0 }`,
      errors: [{ messageId: 'anonymous' }],
    },
    // Function parameter — flagged.
    {
      code: `function f(opts: { a: number }): void { void opts }`,
      errors: [{ messageId: 'anonymous' }],
    },
    // Type assertion — flagged.
    {
      code: `const x = ({} as { a: number })`,
      errors: [{ messageId: 'anonymous' }],
    },
    // Generic argument — flagged.
    {
      code: `const arr: Array<{ id: string }> = []`,
      errors: [{ messageId: 'anonymous' }],
    },
    // Generic constraint — flagged.
    {
      code: `function f<T extends { a: number }>(x: T): T { return x }`,
      errors: [{ messageId: 'anonymous' }],
    },
    // Multiple violations in one snippet.
    {
      code: `function f(opts: { a: number }): { b: number } { return { b: opts.a } }`,
      errors: [{ messageId: 'anonymous' }, { messageId: 'anonymous' }],
    },
    // Class field annotation.
    {
      code: `class C { x: { a: number } = { a: 0 } }`,
      errors: [{ messageId: 'anonymous' }],
    },
    // Constructor type with anonymous return.
    {
      code: `const Ctor: new () => { x: number } = null as never`,
      errors: [{ messageId: 'anonymous' }],
    },
  ],
})
