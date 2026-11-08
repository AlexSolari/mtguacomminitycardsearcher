import { afterEach, beforeEach } from 'bun:test';
import {
    configureLogger,
    type LogConfig,
    type LogRecord
} from '@/server/logger';

// Call at the top of a test file: each test's log records collect in the returned array instead of being written,
// at every level, and the logger's config is restored after the test.
export function captureLogs(): LogRecord[] {
    const logs: LogRecord[] = [];
    let previous: LogConfig;
    beforeEach(() => {
        logs.length = 0;
        previous = configureLogger({
            level: 'debug',
            sink: (record) => logs.push(record)
        });
    });
    afterEach(() => configureLogger(previous));
    return logs;
}
