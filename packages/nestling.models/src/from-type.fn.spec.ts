import { fromType } from './from-type.fn.js';

import { z } from 'zod';

describe('fromType().makeModel', () => {
  it('создаёт схему с явным типом и проверяет сужение типа', () => {
    interface UserProto {
      name?: string;
      email?: string;
    }

    const schema = fromType<UserProto>().makeModel(
      z.object({
        name: z.string().min(1).describe('User name'),
        email: z.email().describe('User email'),
      }),
    );

    expect(schema).toBeDefined();
    expect(schema.shape).toHaveProperty('name');
    expect(schema.shape).toHaveProperty('email');
  });

  it('поддерживает вложенные объекты с проверкой сужения типа', () => {
    interface UserProto {
      address?: {
        street?: string;
        city?: string;
      };
    }

    const schema = fromType<UserProto>().makeModel(
      z.object({
        address: z
          .object({
            street: z.string(),
            city: z.string(),
          })
          .describe('User address'),
      }),
    );

    expect(schema).toBeDefined();
    expect('shape' in schema && schema.shape).toHaveProperty('address');
  });

  describe('допустимые сужения типа (проверки на этапе компиляции)', () => {
    it('разрешает делать необязательное поле обязательным', () => {
      interface UserProto {
        name?: string;
        email?: string;
      }

      // Валидное сужение: optional → required
      const schema = fromType<UserProto>().makeModel(
        z.object({
          name: z.string().min(1),
          email: z.string().email(),
        }),
      );

      expect(schema).toBeDefined();
      expect(schema.shape).toHaveProperty('name');
      expect(schema.shape).toHaveProperty('email');
    });

    it('разрешает сужать string до литеральных типов', () => {
      interface UserProto {
        role?: string;
      }

      // Валидное сужение: string → enum
      const schema = fromType<UserProto>().makeModel(
        z.object({
          role: z.enum(['admin', 'user', 'guest']),
        }),
      );

      expect(schema).toBeDefined();
      expect(schema.shape).toHaveProperty('role');
    });

    it('разрешает использовать подмножество необязательных полей', () => {
      interface UserProto {
        name?: string;
        email?: string;
        phone?: string;
      }

      // Валидное сужение: использование подмножества полей
      const schema = fromType<UserProto>().makeModel(
        z.object({
          name: z.string(),
        }),
      );

      expect(schema).toBeDefined();
      expect(schema.shape).toHaveProperty('name');
      expect(schema.shape).not.toHaveProperty('email');
    });

    it('разрешает сужать number ограничениями', () => {
      interface UserProto {
        age?: number;
      }

      // Валидное сужение: добавление ограничений
      const schema = fromType<UserProto>().makeModel(
        z.object({
          age: z.number().min(0).max(120),
        }),
      );

      expect(schema).toBeDefined();
      expect(schema.shape).toHaveProperty('age');
    });

    it('разрешает сужать unknown до конкретного типа', () => {
      interface UserProto {
        data?: unknown;
      }

      // Валидное сужение: unknown → string
      const schema = fromType<UserProto>().makeModel(
        z.object({
          data: z.string(),
        }),
      );

      expect(schema).toBeDefined();
      expect(schema.shape).toHaveProperty('data');
    });
  });

  describe('недопустимые сужения типа (ошибки компиляции)', () => {
    it('отвергает поле, которого нет в доменном типе', () => {
      interface UserProto {
        name?: string;
      }

      fromType<UserProto>().makeModel(
        // @ts-expect-error - поле 'age' отсутствует в UserProto
        z.object({
          name: z.string(),
          age: z.number(), // это поле не существует в UserProto
        }),
      );
    });

    it('отвергает несовместимый тип поля', () => {
      interface UserProto {
        id?: string;
      }

      fromType<UserProto>().makeModel(
        // @ts-expect-error - id должен быть string, а не number
        z.object({
          id: z.number(), // несовместимый тип
        }),
      );
    });

    it('отвергает попытку сделать обязательное поле необязательным', () => {
      interface UserProto {
        name: string; // обязательное поле
      }

      fromType<UserProto>().makeModel(
        // @ts-expect-error - нельзя сделать обязательное поле optional
        z.object({
          name: z.string().optional(), // попытка сделать optional
        }),
      );
    });

    it('отвергает полностью несвязанную структуру', () => {
      interface UserProto {
        name?: string;
      }

      fromType<UserProto>().makeModel(
        // @ts-expect-error - полностью другая структура
        z.object({
          email: z.string(),
          phone: z.string(),
        }),
      );
    });

    it('отвергает несовместимый тип во вложенном объекте', () => {
      interface UserProto {
        profile?: {
          age?: number;
        };
      }

      fromType<UserProto>().makeModel(
        // @ts-expect-error - age должен быть number, а не string
        z.object({
          profile: z.object({
            age: z.string(), // несовместимый тип во вложенном объекте
          }),
        }),
      );
    });

    it('отвергает лишнее поле во вложенном объекте', () => {
      interface UserProto {
        settings?: {
          theme?: string;
        };
      }

      fromType<UserProto>().makeModel(
        // @ts-expect-error - поле 'language' отсутствует в settings
        z.object({
          settings: z.object({
            theme: z.string(),
            language: z.string(), // дополнительное поле
          }),
        }),
      );
    });

    it('указывает ошибку на конкретном поле с недопустимым типом', () => {
      interface UserProto {
        email: string; // required field
      }

      fromType<UserProto>().makeModel(
        // @ts-expect-error - ошибка должна быть на поле 'email'
        // Проверка на уровне поля: ошибка указывает на конкретное поле
        z.object({
          email: z.string().optional(), // попытка сделать required → optional
        }),
      );
    });

    it('указывает ошибки на нескольких недопустимых полях', () => {
      interface UserProto {
        name: string;
        email: string;
      }

      fromType<UserProto>().makeModel(
        // @ts-expect-error - ошибки должны быть на полях 'name' и 'email'
        z.object({
          name: z.string().optional(), // ошибка на name
          email: z.number(), // ошибка на email (несовместимый тип)
        }),
      );
    });
  });

  describe('глубоко вложенные объекты (проверка на уровне полей)', () => {
    it('проверяет объект с тремя уровнями вложенности', () => {
      interface UserProto {
        profile?: {
          address?: {
            city?: string;
          };
        };
      }

      const schema = fromType<UserProto>().makeModel(
        z.object({
          profile: z.object({
            address: z.object({
              city: z.string().min(1),
            }),
          }),
        }),
      );

      expect(schema).toBeDefined();
      expect(schema.shape.profile).toBeDefined();
    });

    it('отвергает недопустимый тип на третьем уровне вложенности', () => {
      interface UserProto {
        profile?: {
          address?: {
            city?: string;
          };
        };
      }

      fromType<UserProto>().makeModel(
        // @ts-expect-error - ошибка должна указывать на 'profile.address.city'
        z.object({
          profile: z.object({
            address: z.object({
              city: z.number(), // неверный тип на глубоком уровне
            }),
          }),
        }),
      );
    });

    it('отвергает лишнее поле на третьем уровне вложенности', () => {
      interface UserProto {
        profile?: {
          address?: {
            city?: string;
          };
        };
      }

      fromType<UserProto>().makeModel(
        // @ts-expect-error - ошибка должна указывать на 'profile.address.zipCode'
        z.object({
          profile: z.object({
            address: z.object({
              city: z.string(),
              zipCode: z.string(), // лишнее поле на глубоком уровне
            }),
          }),
        }),
      );
    });

    it('проверяет объект с четырьмя уровнями вложенности', () => {
      interface UserProto {
        data?: {
          user?: {
            profile?: {
              avatar?: {
                url?: string;
              };
            };
          };
        };
      }

      const schema = fromType<UserProto>().makeModel(
        z.object({
          data: z.object({
            user: z.object({
              profile: z.object({
                avatar: z.object({
                  url: z.string().url(),
                }),
              }),
            }),
          }),
        }),
      );

      expect(schema).toBeDefined();
    });

    it('отвергает недопустимый тип на четвёртом уровне вложенности', () => {
      interface UserProto {
        data?: {
          user?: {
            profile?: {
              avatar?: {
                url?: string;
              };
            };
          };
        };
      }

      fromType<UserProto>().makeModel(
        // @ts-expect-error - ошибка должна указывать на полный путь к полю
        z.object({
          data: z.object({
            user: z.object({
              profile: z.object({
                avatar: z.object({
                  url: z.number(), // неверный тип на очень глубоком уровне
                }),
              }),
            }),
          }),
        }),
      );
    });
  });

  describe('преобразования в fromType', () => {
    it('поддерживает простой transform', () => {
      interface UserProto {
        id?: string;
      }

      const schema = fromType<UserProto>().makeModel(
        z.object({
          id: z.string().transform((val) => Number.parseInt(val, 10)),
        }),
      );

      expect(schema).toBeDefined();
      expect(schema.shape).toHaveProperty('id');
    });

    it('преобразует string в number и проверяет вход', () => {
      interface GetUserProto {
        id?: string;
        page?: string;
      }

      const schema = fromType<GetUserProto>().makeModel(
        z.object({
          id: z
            .string()
            .regex(/^\d+$/)
            .transform((val) => Number.parseInt(val, 10)),
          page: z
            .string()
            .optional()
            .transform((val) => (val ? Number.parseInt(val, 10) : undefined)),
        }),
      );

      expect(schema).toBeDefined();

      // Проверяем что схема валидирует и трансформирует
      const result = schema.parse({ id: '123', page: '5' });
      expect(result.id).toBe(123);
      expect(result.page).toBe(5);
    });

    it('убирает префикс Bearer из токена', () => {
      interface AuthProto {
        authorization?: string;
      }

      const schema = fromType<AuthProto>().makeModel(
        z.object({
          authorization: z
            .string()
            .regex(/^Bearer .+$/)
            .transform((val) => val.replace('Bearer ', '')),
        }),
      );

      expect(schema).toBeDefined();

      const result = schema.parse({ authorization: 'Bearer token123' });
      expect(result.authorization).toBe('token123');
    });

    it('поддерживает цепочку transform', () => {
      interface UserProto {
        email?: string;
      }

      const schema = fromType<UserProto>().makeModel(
        z.object({
          email: z
            .string()
            .transform((val) => val.toLowerCase())
            .transform((val) => val.trim()),
        }),
      );

      expect(schema).toBeDefined();

      const result = schema.parse({ email: '  USER@EXAMPLE.COM  ' });
      expect(result.email).toBe('user@example.com');
    });

    it('преобразует поле вложенного объекта', () => {
      interface UserProto {
        metadata?: {
          createdAt?: string;
        };
      }

      const schema = fromType<UserProto>().makeModel(
        z.object({
          metadata: z.object({
            createdAt: z.string().transform((val) => new Date(val)),
          }),
        }),
      );

      expect(schema).toBeDefined();

      const result = schema.parse({
        metadata: { createdAt: '2024-01-01T00:00:00Z' },
      });
      expect(result.metadata.createdAt).toBeInstanceOf(Date);
    });

    it('поддерживает transform вместе с refine', () => {
      interface UserProto {
        age?: string;
      }

      const schema = fromType<UserProto>().makeModel(
        z.object({
          age: z
            .string()
            .transform((val) => Number.parseInt(val, 10))
            .refine((val) => val >= 0 && val <= 150, {
              message: 'Age must be between 0 and 150',
            }),
        }),
      );

      expect(schema).toBeDefined();

      const validResult = schema.parse({ age: '25' });
      expect(validResult.age).toBe(25);

      expect(() => schema.parse({ age: '200' })).toThrow();
    });

    it('разрешает transform, меняющий тип выхода относительно входа', () => {
      interface ProtoType {
        timestamp?: string;
        count?: string;
      }

      // Вход: string, выход: Date | number
      const schema = fromType<ProtoType>().makeModel(
        z.object({
          timestamp: z.string().transform((val) => new Date(val)),
          count: z.string().transform((val) => Number.parseInt(val, 10)),
        }),
      );

      expect(schema).toBeDefined();

      const result = schema.parse({
        timestamp: '2024-01-01T00:00:00Z',
        count: '42',
      });

      expect(result.timestamp).toBeInstanceOf(Date);
      expect(typeof result.count).toBe('number');
      expect(result.count).toBe(42);
    });

    it('работает с transform на необязательном поле', () => {
      interface UserProto {
        phone?: string;
      }

      const schema = fromType<UserProto>().makeModel(
        z.object({
          phone: z
            .string()
            .optional()
            .transform((val) => val?.replace(/\D/g, '')),
        }),
      );

      expect(schema).toBeDefined();

      const result1 = schema.parse({ phone: '+1 (555) 123-4567' });
      expect(result1.phone).toBe('15551234567');

      const result2 = schema.parse({});
      expect(result2.phone).toBeUndefined();
    });

    it('преобразует элементы массива', () => {
      interface UserProto {
        tags?: string[];
      }

      const schema = fromType<UserProto>().makeModel(
        z.object({
          tags: z
            .array(z.string())
            .transform((arr) => arr.map((tag) => tag.toLowerCase())),
        }),
      );

      expect(schema).toBeDefined();

      const result = schema.parse({ tags: ['FOO', 'Bar', 'BAZ'] });
      expect(result.tags).toEqual(['foo', 'bar', 'baz']);
    });
  });
});
