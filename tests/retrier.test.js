/**
 * @fileoverview Tests for the Retrier class.
 */
/*global describe, it, beforeEach, afterEach*/

//-----------------------------------------------------------------------------
// Requirements
//-----------------------------------------------------------------------------

import { Retrier } from "../src/retrier.js";
import assert from "node:assert";

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("Retrier", () => {

    describe("new Retrier()", () => {

        it("should throw an error when a function isn't passed", () => {
            assert.throws(() => {
                // @ts-expect-error
                new Retrier();
            }, /Missing function/);
        });

    });

    describe("retry()", () => {
        
        it("should retry a function that rejects an error", async () => {

            let count = 0;
            const retrier = new Retrier(error => error.message === "foo");
            const result = await retrier.retry(async () => {
                count++;

                if (count === 1) {
                    throw new Error("foo");
                }

                return count;
            });

            assert.equal(result, 2);
        });

        it("should retry a function that rejects an error multiple times", async () => {

            let count = 0;
            const retrier = new Retrier(error => error.message === "foo");
            const result = await retrier.retry(async () => {
                count++;

                if (count < 5) {
                    throw new Error("foo");
                }

                return count;
            });

            assert.equal(result, 5);
        });

        it("should reject an error when the function is synchronous", async () => {

            const retrier = new Retrier(error => error.message === "foo");

            assert.rejects(async () => {
                await retrier.retry(() => {
                    throw new Error("foo");
                });
            }, /Cannot catch synchronous errors/);
        });

        it("should reject an error when the function doesn't return a promise", async () => {

            const retrier = new Retrier(error => error.message === "foo");

            assert.rejects(async () => {
                // @ts-expect-error
                await retrier.retry(() => {});
            }, /Result is not a promise/);
        });

    });

});
