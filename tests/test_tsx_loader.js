// Тест TSX loader
// tests/test_tsx_loader.js

const path = require('path');
const { parseTsxEntitiesFromContent, parseTsxL1, isCustomHook, isComponentName } = require('../routes/loaders/tsxLoader');

const TEST_TSX_CONTENT = `
import React, { useState, useEffect, useCallback, memo, forwardRef } from 'react';
import { Button } from './Button';
import type { UserProps } from './types';

/**
 * Props интерфейс для TestComponent
 */
interface TestComponentProps {
  title: string;
  count?: number;
  onAction: () => void;
}

/**
 * Type alias для стилей
 */
type ButtonVariant = 'primary' | 'secondary' | 'danger';

/**
 * Кастомный хук для работы с локальным состоянием
 */
function useLocalState(initialValue) {
  const [value, setValue] = useState(initialValue);
  
  const reset = useCallback(() => {
    setValue(initialValue);
  }, [initialValue]);

  return { value, setValue, reset };
}

/**
 * Основной функциональный компонент
 */
function TestComponent({ title, count = 0, onAction }) {
  const { value, setValue } = useLocalState(count);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    console.log('Component mounted');
    return () => console.log('Component unmounted');
  }, []);

  const handleClick = useCallback(() => {
    setIsLoading(true);
    onAction();
    setValue(prev => prev + 1);
  }, [onAction, setValue]);

  return (
    <div className="test-component">
      <h1>{title}</h1>
      <span>Count: {value}</span>
      <Button onClick={handleClick} disabled={isLoading}>
        Click me
      </Button>
      <ChildComponent name="test" />
    </div>
  );
}

/**
 * Дочерний компонент как arrow function
 */
const ChildComponent = ({ name }) => {
  return <span>Hello, {name}!</span>;
};

/**
 * Компонент с forwardRef
 */
const ForwardedInput = forwardRef(
  ({ label }, ref) => {
    return (
      <label>
        {label}
        <input ref={ref} type="text" />
      </label>
    );
  }
);

/**
 * Мемоизированный компонент
 */
const MemoizedDisplay = memo(function Display({ text }) {
  return <p>{text}</p>;
});

/**
 * Класс-компонент
 */
class ClassComponent extends React.Component {
  state = { clicked: false };

  handleClick = () => {
    this.setState({ clicked: true });
  };

  render() {
    return (
      <div onClick={this.handleClick}>
        {this.props.message}
        {this.state.clicked && <span>Clicked!</span>}
      </div>
    );
  }
}

export default TestComponent;
export { ChildComponent, ForwardedInput, MemoizedDisplay, ClassComponent, useLocalState };
`;

async function runTests() {
  console.log('\n=== TSX Loader Tests ===\n');
  
  let passed = 0;
  let failed = 0;

  // Test 1: isCustomHook
  console.log('Test 1: isCustomHook()');
  const hookTests = [
    { name: 'useState', expected: true },       // встроенный hook тоже соответствует паттерну
    { name: 'useEffect', expected: true },      // встроенный hook тоже соответствует паттерну
    { name: 'useLocalState', expected: true },
    { name: 'useCustomHook', expected: true },
    { name: 'myFunction', expected: false }
  ];
  
  for (const test of hookTests) {
    const result = isCustomHook(test.name);
    if (result === test.expected) {
      console.log(`  \u2713 isCustomHook('${test.name}') = ${result}`);
      passed++;
    } else {
      console.log(`  \u2717 isCustomHook('${test.name}') = ${result}, expected ${test.expected}`);
      failed++;
    }
  }

  // Test 2: isComponentName
  console.log('\nTest 2: isComponentName()');
  const componentTests = [
    { name: 'Button', expected: true },
    { name: 'MyComponent', expected: true },
    { name: 'button', expected: false },
    { name: 'handleClick', expected: false }
  ];
  
  for (const test of componentTests) {
    const result = isComponentName(test.name);
    if (result === test.expected) {
      console.log(`  \u2713 isComponentName('${test.name}') = ${result}`);
      passed++;
    } else {
      console.log(`  \u2717 isComponentName('${test.name}') = ${result}, expected ${test.expected}`);
      failed++;
    }
  }

  // Test 3: parseTsxEntitiesFromContent
  console.log('\nTest 3: parseTsxEntitiesFromContent()');
  
  const entities = parseTsxEntitiesFromContent(TEST_TSX_CONTENT, 'TestComponent.tsx');
  console.log(`  Found ${entities.length} entities`);
  
  const expectedEntities = [
    { name: 'TestComponentProps', type: 'interface' },
    { name: 'ButtonVariant', type: 'type' },
    { name: 'useLocalState', type: 'tsx_hook' },
    { name: 'TestComponent', type: 'tsx_component' },
    { name: 'ChildComponent', type: 'tsx_component' },
    { name: 'ForwardedInput', type: 'tsx_component' },
    { name: 'MemoizedDisplay', type: 'tsx_component' },
    { name: 'ClassComponent', type: 'tsx_component' }
  ];
  
  for (const expected of expectedEntities) {
    const found = entities.find(e => e.full_name === expected.name);
    if (found) {
      if (found.type === expected.type) {
        console.log(`  \u2713 Found '${expected.name}' with type '${found.type}'`);
        passed++;
      } else {
        console.log(`  \u2717 '${expected.name}' has type '${found.type}', expected '${expected.type}'`);
        failed++;
      }
    } else {
      console.log(`  \u2717 Entity '${expected.name}' not found`);
      failed++;
    }
  }

  // Test 4: parseTsxL1 - связи
  console.log('\nTest 4: parseTsxL1() - TestComponent links');
  
  const testComponent = entities.find(e => e.full_name === 'TestComponent');
  if (testComponent) {
    const l1 = await parseTsxL1(testComponent.body, 'tsx_component');
    console.log('  L1 result:', JSON.stringify(l1, null, 2));
    
    // Проверяем uses_hooks
    if (l1.uses_hooks && l1.uses_hooks.includes('useLocalState')) {
      console.log('  \u2713 Found uses_hook: useLocalState');
      passed++;
    } else {
      console.log('  \u2717 Missing uses_hook: useLocalState');
      failed++;
    }
    
    // Проверяем uses_components
    if (l1.uses_components && l1.uses_components.includes('Button')) {
      console.log('  \u2713 Found uses_component: Button');
      passed++;
    } else {
      console.log('  \u2717 Missing uses_component: Button');
      failed++;
    }
    
    if (l1.uses_components && l1.uses_components.includes('ChildComponent')) {
      console.log('  \u2713 Found uses_component: ChildComponent');
      passed++;
    } else {
      console.log('  \u2717 Missing uses_component: ChildComponent');
      failed++;
    }
  } else {
    console.log('  \u2717 TestComponent not found');
    failed++;
  }

  // Test 5: Metadata для wrapper компонентов
  console.log('\nTest 5: Wrapper metadata');
  
  const forwardedInput = entities.find(e => e.full_name === 'ForwardedInput');
  if (forwardedInput && forwardedInput.metadata?.wrapper === 'forwardRef') {
    console.log('  \u2713 ForwardedInput has wrapper=forwardRef');
    passed++;
  } else {
    console.log(`  \u2717 ForwardedInput wrapper: ${forwardedInput?.metadata?.wrapper || 'not set'}`);
    failed++;
  }
  
  const memoizedDisplay = entities.find(e => e.full_name === 'MemoizedDisplay');
  if (memoizedDisplay && memoizedDisplay.metadata?.wrapper === 'memo') {
    console.log('  \u2713 MemoizedDisplay has wrapper=memo');
    passed++;
  } else {
    console.log(`  \u2717 MemoizedDisplay wrapper: ${memoizedDisplay?.metadata?.wrapper || 'not set'}`);
    failed++;
  }

  // Test 6: Проверка classComponent metadata
  console.log('\nTest 6: Class component metadata');
  
  const classComponent = entities.find(e => e.full_name === 'ClassComponent');
  if (classComponent && classComponent.metadata?.classComponent === true) {
    console.log('  \u2713 ClassComponent has classComponent=true');
    passed++;
  } else {
    console.log(`  \u2717 ClassComponent classComponent: ${classComponent?.metadata?.classComponent || 'not set'}`);
    failed++;
  }

  // Итоги
  console.log('\n=== Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);
  
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
