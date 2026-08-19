import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Recurso protegido de ejemplo: demuestra que el guard funciona de
 * punta a punta. El payload que ves acá fue verificado LOCALMENTE por
 * el gateway — no hubo ninguna llamada a auth-ms para servir este
 * request.
 */
@Controller('users')
export class UsersController {
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() request: Request & { user?: unknown }) {
    return request.user;
  }
}
