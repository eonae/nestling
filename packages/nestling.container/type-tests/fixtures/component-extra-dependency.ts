/**
 * Фикстура: у класса без метода `handle` список зависимостей длиннее
 * списка параметров конструктора.
 *
 * Ограничение параметра декоратора такой класс проходит: конструктор с
 * меньшим числом параметров подходит под конструктор с бо́льшим. Поэтому
 * тип экземпляра выводится точно, и диагностика говорит только о длине
 * списка. Снапшот закрепляет этот случай как границу: чужого текста тут
 * не было и до страховки от `any`.
 */

import { Component } from '@nestlingjs/container';

import { Database, Logger$ } from '../support/fixture-kit.js';

@Component([Database, Logger$])
export class UserService {
  constructor(private readonly db: Database) {}
}
