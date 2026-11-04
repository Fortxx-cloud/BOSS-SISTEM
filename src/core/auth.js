import crypto from 'node:crypto';
import { config } from './config.js';

export function authenticate(req, res, next) {
    const authorization = req.headers.authorization || '';
    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({
            success: false,
            error: 'UNAUTHORIZED'
        });
    }

    const expected = Buffer.from(config.secret);
    const received = Buffer.from(token);

    if (
        expected.length !== received.length ||
        !crypto.timingSafeEqual(expected, received)
    ) {
        return res.status(403).json({
            success: false,
            error: 'INVALID_TOKEN'
        });
    }

    next();
}
