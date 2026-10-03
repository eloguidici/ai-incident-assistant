"""Test benchmark approval failures without loading Torch or executing inference."""

import ast
from pathlib import Path

import pytest


def require_equivalent():
    """Load the self-contained reporter gate AST without executing its model imports."""
    source = ast.parse(Path(__file__).with_name('performance.py').read_text())
    gate = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'require_equivalent')
    namespace = {}
    exec(compile(ast.Module(body=[gate], type_ignores=[]), 'performance.py', 'exec'), namespace)
    return namespace['require_equivalent']


def test_equivalent_reports_succeed():
    """Accept only explicit equivalent comparison results."""
    require_equivalent()([{'allEquivalent': True}, {'allEquivalent': True}])


@pytest.mark.parametrize('configurations', [[], [{'allEquivalent': False}], [{'allEquivalent': True}, {'allEquivalent': False}]])
def test_divergent_or_missing_reports_fail(configurations):
    """A persisted mismatch or absent comparison must produce exit code2."""
    with pytest.raises(SystemExit) as failure:
        require_equivalent()(configurations)
    assert failure.value.code == 2
