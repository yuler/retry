/**
 * @fileoverview A utility for retrying failed async method calls.
 */
//-----------------------------------------------------------------------------
// Constants
//-----------------------------------------------------------------------------

const MAX_TASK_TIMEOUT = 60000;
const MAX_TASK_DELAY = 100;

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/*
 * The following logic has been extracted from graceful-fs.
 *
 * The ISC License
 *
 * Copyright (c) 2011-2023 Isaac Z. Schlueter, Ben Noordhuis, and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
 * IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

/**
 * Checks if it is time to retry a task based on the timestamp and last attempt time.
 * @param {RetryTask} task The task to check.
 * @param {number} maxDelay The maximum delay for the queue.
 * @returns {boolean} true if it is time to retry, false otherwise.
 */
function isTimeToRetry(task, maxDelay) {
    const timeSinceLastAttempt = Date.now() - task.lastAttempt;
    const timeSinceStart = Math.max(task.lastAttempt - task.timestamp, 1);
    const desiredDelay = Math.min(timeSinceStart * 1.2, maxDelay);

    return timeSinceLastAttempt >= desiredDelay;
}

/**
 * Checks if it is time to bail out based on the given timestamp.
 * @param {RetryTask} task The task to check.
 * @param {number} timeout The timeout for the queue.
 * @returns {boolean} true if it is time to bail, false otherwise.
 */
function isTimeToBail(task, timeout) {
    return Date.now() - task.timestamp > timeout;
}


/**
 * A class to represent a task in the retry queue.
 */
class RetryTask {
    /**
     * The function to call.
     * @type {Function}
     */
    fn;

    /**
     * The error that was thrown.
     * @type {Error}
     */
    error;
    
    /**
     * The timestamp of the task.
     * @type {number}
     */
    timestamp = Date.now();

    /**
     * The timestamp of the last attempt.
     * @type {number}
     */
    lastAttempt = this.timestamp;

    /**
     * The resolve function for the promise.
     * @type {Function}
     */
    resolve;

    /**
     * The reject function for the promise.
     * @type {Function}
     */
    reject;

    /**
     * Creates a new instance.
     * @param {Function} fn The function to call.
     * @param {Error} error The error that was thrown.
     * @param {Function} resolve The resolve function for the promise.
     * @param {Function} reject The reject function for the promise.
     */
    constructor(fn, error, resolve, reject) {
        this.fn = fn;
        this.error = error;
        this.timestamp = Date.now();
        this.lastAttempt = Date.now();
        this.resolve = resolve;
        this.reject = reject;
    }
    
}

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * A class that manages a queue of retry jobs.
 */
export class Retrier {
    /**
     * Represents the queue for processing tasks.
     * @type {Array<RetryTask>}
     */
    #queue = [];

    /**
     * The timeout for the queue.
     * @type {number}
     */
    #timeout;

    /**
     * The maximum delay for the queue.
     * @type {number}
     */
    #maxDelay;

    /**
     * The setTimeout() timer ID.
     * @type {NodeJS.Timeout|undefined}
     */
    #timerId;

    /**
     * The function to call.
     * @type {Function}
     */
    #check;

    /**
     * Creates a new instance.
     * @param {Function} check The function to call.
     * @param {object} [options] The options for the instance.
     * @param {number} [options.timeout] The timeout for the queue.
     * @param {number} [options.maxDelay] The maximum delay for the queue.
     */
    constructor(check, { timeout = MAX_TASK_TIMEOUT, maxDelay = MAX_TASK_DELAY } = {}) {

        if (typeof check !== "function") {
            throw new Error("Missing function to check errors");
        }

        this.#timeout = timeout;
        this.#check = check;
        this.#timeout = timeout;
        this.#maxDelay = maxDelay;
    }

    /**
     * Adds a new retry job to the queue.
     * @param {Function} fn The function to call.
     * @returns {Promise<any>} A promise that resolves when the queue is
     *  processed.
     */
    retry(fn) {

        let result;

        try {
            result = fn();
        } catch (error) {
            return Promise.reject(new Error("Cannot catch synchronous errors."));
        }

        // if the result is not a promise then reject an error
        if (!(result instanceof Promise)) {
            return Promise.reject(new Error("Result is not a promise."));
        }

        // call the original function and catch any ENFILE or EMFILE errors
        // @ts-ignore because we know it's any
        return result.catch(error => {
            if (!this.#check(error)) {
                throw error;
            }

            return new Promise((resolve, reject) => {
                this.#queue.push(new RetryTask(fn, error, resolve, reject));
                this.#processQueue();
            });
        });
    }

    /**
     * Processes the queue.
     * @returns {void}
     */
    #processQueue() {
        // clear any timer because we're going to check right now
        clearTimeout(this.#timerId);
        this.#timerId = undefined;

        // if there's nothing in the queue, we're done
        const task = this.#queue.shift();
        if (!task) {
            return;
        }

        // if it's time to bail, then bail
        if (isTimeToBail(task, this.#timeout)) {
            task.reject(task.error);
            this.#processQueue();
            return;
        }

        // if it's not time to retry, then wait and try again
        if (!isTimeToRetry(task, this.#maxDelay)) {
            this.#queue.unshift(task);
            this.#timerId = setTimeout(() => this.#processQueue(), 0);
            return;
        }

        // otherwise, try again
        task.lastAttempt = Date.now();
        task.fn()
            // @ts-ignore because we know it's any
            .then(result => task.resolve(result))

            // @ts-ignore because we know it's any
            .catch(error => {
                if (!this.#check(error)) {
                    task.reject(error);
                }

                // update the task timestamp and push to back of queue to try again
                task.lastAttempt = Date.now();
                this.#queue.push(task);
            })
            .finally(() => this.#processQueue());
    }
}
