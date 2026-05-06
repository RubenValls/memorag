import { StaticParser } from '../../src/static/StaticParser'

describe('StaticParser — TypeScript/JavaScript', () => {
  const tsContent = `
import { UserRepository } from './UserRepository'
import { hashPassword } from '../utils/crypto'

export class AuthService {
  async login(email: string, password: string) {
    const user = await this.repo.findByEmail(email)
    if (!user) throw new UnauthorizedError('Invalid credentials')
    if (!this.verify(password, user.hash)) throw new AuthError('Bad password')
  }

  logout() {
    this.session.destroy()
  }

  verify(password: string, hash: string) {
    return hashPassword(password) === hash
  }
}
`

  it('extracts classes from TypeScript', () => {
    const result = StaticParser.parse('/src/auth/AuthService.ts', tsContent)
    expect(result).not.toBeNull()
    expect(result!.classes || result!.exposes).toContain('AuthService')
  })

  it('extracts local import dependencies', () => {
    const result = StaticParser.parse('/src/auth/AuthService.ts', tsContent)
    expect(result).not.toBeNull()
    expect(result!.dependencies).toContain('UserRepository')
    expect(result!.dependencies).toContain('crypto')
  })

  it('extracts thrown errors', () => {
    const result = StaticParser.parse('/src/auth/AuthService.ts', tsContent)
    expect(result).not.toBeNull()
    expect(result!.throws).toContain('UnauthorizedError')
    expect(result!.throws).toContain('AuthError')
  })

  it('computes source hash', () => {
    const result = StaticParser.parse('/src/auth/AuthService.ts', tsContent)
    expect(result).not.toBeNull()
    expect(result!.sourceHash).toBeTruthy()
    expect(result!.sourceHash.length).toBe(16)
  })

  it('sets module name from filename', () => {
    const result = StaticParser.parse('/src/auth/AuthService.ts', tsContent)
    expect(result!.name).toBe('AuthService')
  })

  it('generates responsibility string', () => {
    const result = StaticParser.parse('/src/auth/AuthService.ts', tsContent)
    expect(result!.responsibility).toContain('AuthService')
  })

  it('generates tags from module and class names', () => {
    const result = StaticParser.parse('/src/auth/AuthService.ts', tsContent)
    expect(result!.tags.length).toBeGreaterThan(0)
    expect(result!.tags).toContain('auth')
  })

  it('skips unchanged files — same content produces same hash', () => {
    const r1 = StaticParser.parse('/src/auth/AuthService.ts', tsContent)
    const r2 = StaticParser.parse('/src/auth/AuthService.ts', tsContent)
    expect(r1!.sourceHash).toBe(r2!.sourceHash)
  })

  it('handles export list syntax', () => {
    const content = `
import { foo } from './foo'
export { foo, bar }
export const bar = 42
`
    const result = StaticParser.parse('/src/index.ts', content)
    expect(result!.exposes).toContain('bar')
  })

  it('handles require() imports', () => {
    const content = `
const UserRepository = require('./UserRepository')
module.exports = { UserService }
`
    const result = StaticParser.parse('/src/user/UserService.js', content)
    expect(result!.dependencies).toContain('UserRepository')
  })
})

describe('StaticParser — Python', () => {
  const pyContent = `
from .repository import UserRepository
from .utils.crypto import hash_password

class AuthService:
    def login(self, email, password):
        user = self.repo.find_by_email(email)
        if not user:
            raise UnauthorizedError("Invalid credentials")

    def logout(self):
        self.session.destroy()

    def verify(self, password, hash_val):
        return hash_password(password) == hash_val
`

  it('extracts classes from Python', () => {
    const result = StaticParser.parse('/src/auth/auth_service.py', pyContent)
    expect(result).not.toBeNull()
    expect(result!.exposes).toContain('AuthService')
  })

  it('extracts local import dependencies', () => {
    const result = StaticParser.parse('/src/auth/auth_service.py', pyContent)
    expect(result!.dependencies).toContain('.repository')
  })

  it('extracts raised errors', () => {
    const result = StaticParser.parse('/src/auth/auth_service.py', pyContent)
    expect(result!.throws).toContain('UnauthorizedError')
  })
})

describe('StaticParser — Go', () => {
  const goContent = `
package auth

import (
	"errors"
	"fmt"
)

type AuthService struct {
	repo UserRepository
}

func (s *AuthService) Login(email, password string) error {
	user := s.repo.FindByEmail(email)
	if user == nil {
		return errors.New("not found")
	}
	return nil
}

func NewService() *AuthService {
	return &AuthService{}
}
`

  it('extracts exported functions from Go', () => {
    const result = StaticParser.parse('/auth/service.go', goContent)
    expect(result).not.toBeNull()
    expect(result!.exposes.length).toBeGreaterThan(0)
  })

  it('extracts struct types', () => {
    const result = StaticParser.parse('/auth/service.go', goContent)
    expect(result!.classes).toContain('AuthService')
  })
})

describe('StaticParser — Rust', () => {
  const rsContent = `
use crate::repository::UserRepository;

pub struct AuthService {
    repo: UserRepository,
}

impl AuthService {
    pub fn login(&self, email: &str, password: &str) -> Result<bool, AuthError> {
        let user = self.repo.find_by_email(email)?;
        Ok(self.verify(password, user.hash))
    }

    fn verify(&self, password: &str, hash: &str) -> bool {
        true
    }
}
`

  it('extracts pub struct from Rust', () => {
    const result = StaticParser.parse('/src/auth/service.rs', rsContent)
    expect(result).not.toBeNull()
    expect(result!.exposes).toContain('AuthService')
  })

  it('extracts pub fn from Rust', () => {
    const result = StaticParser.parse('/src/auth/service.rs', rsContent)
    expect(result!.exposes).toContain('login')
  })

  it('extracts crate dependencies', () => {
    const result = StaticParser.parse('/src/auth/service.rs', rsContent)
    expect(result!.dependencies).toContain('repository')
  })
})

describe('StaticParser — Java', () => {
  const javaContent = `
package com.example.auth;

import com.example.user.UserRepository;

public class AuthService {
    private UserRepository repo;

    public boolean login(String email, String password) throws UnauthorizedException {
        return false;
    }

    protected void logout() {
    }
}
`

  it('extracts class from Java', () => {
    const result = StaticParser.parse('/src/auth/AuthService.java', javaContent)
    expect(result).not.toBeNull()
    expect(result!.classes).toContain('AuthService')
  })

  it('extracts throws from Java', () => {
    const result = StaticParser.parse('/src/auth/AuthService.java', javaContent)
    expect(result!.throws.length).toBeGreaterThan(0)
  })
})

describe('StaticParser — Ruby', () => {
  const rbContent = `
require_relative 'user_repository'

class AuthService
  def initialize(repo)
    @repo = repo
  end

  def login(email, password)
    raise UnauthorizedError, 'invalid' unless @repo.find(email)
  end

  def logout
    @session&.destroy
  end
end
`

  it('extracts class from Ruby', () => {
    const result = StaticParser.parse('/lib/auth/auth_service.rb', rbContent)
    expect(result).not.toBeNull()
    expect(result!.classes).toContain('AuthService')
  })

  it('extracts require_relative dependencies', () => {
    const result = StaticParser.parse('/lib/auth/auth_service.rb', rbContent)
    expect(result!.dependencies).toContain('user_repository')
  })

  it('extracts raised errors', () => {
    const result = StaticParser.parse('/lib/auth/auth_service.rb', rbContent)
    expect(result!.throws).toContain('UnauthorizedError')
  })
})

describe('StaticParser — edge cases', () => {
  it('returns null for unsupported extensions', () => {
    const result = StaticParser.parse('/src/data.csv', 'a,b,c')
    expect(result).toBeNull()
  })

  it('handles empty files', () => {
    const result = StaticParser.parse('/src/empty.ts', '')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('empty')
    expect(result!.exposes).toEqual([])
    expect(result!.dependencies).toEqual([])
  })

  it('deduplicates exports', () => {
    const content = `
export class Foo {}
export class Foo {}
`
    const result = StaticParser.parse('/src/foo.ts', content)
    expect(result!.exposes.filter(e => e === 'Foo')).toHaveLength(1)
  })
})